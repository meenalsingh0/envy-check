import { readFile } from 'node:fs/promises';
import type { EnvyConfig, SecretFinding, SecretPattern } from '../types.js';

/** Secret formats detected by prefix, regardless of entropy. */
const KNOWN_PATTERNS: SecretPattern[] = [
  { name: 'stripe-secret-key', pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', pattern: /\bgh[po]_[A-Za-z0-9]{20,}/ },
  { name: 'gitlab-pat', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { name: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}/ },
];

/**
 * Object keys that mark a value as documentation/sample data rather than a
 * real secret (matched case-insensitively as `key:` or `"key":`). A
 * high-entropy token on or near such a line is skipped. Extendable via
 * `EnvyConfig.docContextKeys`.
 */
export const DOC_CONTEXT_KEYS: string[] = [
  'example',
  'examples',
  'sample',
  'mock',
  'default',
  'placeholder',
  'dummy',
  'fixture',
];

/**
 * Decorators whose arguments are documentation (e.g. Swagger/OpenAPI
 * metadata in NestJS). A high-entropy token on or near a `@Name(` line is
 * skipped. Extendable via `EnvyConfig.docDecorators`.
 */
export const DOC_DECORATORS: string[] = [
  'ApiProperty',
  'ApiPropertyOptional',
  'ApiResponse',
  'ApiOkResponse',
  'ApiBody',
  'ApiQuery',
  'ApiParam',
];

const DEFAULT_ENTROPY_THRESHOLD = 4.0;
const DEFAULT_MIN_TOKEN_LENGTH = 20;
const DEFAULT_CONTEXT_LOOKBACK_LINES = 5;

// Candidate tokens for the entropy heuristic. `/` is deliberately excluded so
// file paths and URLs split into short, ignorable segments.
const TOKEN_RE = /[A-Za-z0-9+=_-]{20,}/g;

// `envy-ignore` after a comment marker (//, #, /* */, *, <!--) suppresses
// every finding on that line and the line below it.
const IGNORE_COMMENT_RE = /(?:\/\/|#|\/\*|\*|<!--).*envy-ignore/;

/**
 * Computes the Shannon entropy of a string in bits per character.
 * Higher values mean more uniformly distributed characters; random secrets
 * typically score above 4, English words below 3.5.
 *
 * @param value - String to measure.
 * @returns Entropy in bits per character (0 for empty or single-char strings).
 */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;

  const frequencies = new Map<string, number>();
  for (const char of value) {
    frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of frequencies.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Produces a safe preview of a secret: its first 4 characters followed by a
 * fixed run of asterisks (fixed so the redacted form does not reveal the
 * secret's length).
 *
 * @param value - The sensitive value.
 * @returns Redacted preview, e.g. `sk_l********`.
 */
export function redactSecret(value: string): string {
  return `${value.slice(0, 4)}${'*'.repeat(8)}`;
}

/**
 * Scans file content for values that look like committed secrets, using
 * known-format patterns first and a Shannon-entropy heuristic as a fallback.
 * Findings never contain the full value — only a redacted preview.
 *
 * Two suppression mechanisms reduce false positives:
 * - An `envy-ignore` comment on a line (or the line above) suppresses ALL
 *   findings on that line — the explicit, manual escape hatch.
 * - High-entropy tokens (only — never known-format matches) are skipped when
 *   documentation context appears on the token's line or up to
 *   `config.contextLookbackLines` (default 5) lines above it: a
 *   {@link DOC_CONTEXT_KEYS} key (`example:`, `"placeholder":`, …) or a
 *   {@link DOC_DECORATORS} call (`@ApiProperty(`), since such values are
 *   sample data, not secrets. `config.docContextKeys` and
 *   `config.docDecorators` extend (not replace) the built-in lists.
 *
 * @param content - Raw text of the file.
 * @param filePath - Path recorded on each finding (not read from disk).
 * @param config - Optional overrides: `entropyThreshold`, `minTokenLength`,
 *   `customSecretPatterns`, plus the context-exclusion settings
 *   `docContextKeys`, `docDecorators`, and `contextLookbackLines`.
 * @returns All potential secrets found, in line order.
 */
export function scanContentForSecrets(
  content: string,
  filePath: string,
  config: EnvyConfig = {},
): SecretFinding[] {
  const threshold = config.entropyThreshold ?? DEFAULT_ENTROPY_THRESHOLD;
  const minLength = config.minTokenLength ?? DEFAULT_MIN_TOKEN_LENGTH;
  const lookback = config.contextLookbackLines ?? DEFAULT_CONTEXT_LOOKBACK_LINES;
  const patterns = [...KNOWN_PATTERNS, ...(config.customSecretPatterns ?? [])];
  const docKeyRe = buildDocKeyRegExp([...DOC_CONTEXT_KEYS, ...(config.docContextKeys ?? [])]);
  const docDecoratorRe = buildDocDecoratorRegExp([
    ...DOC_DECORATORS,
    ...(config.docDecorators ?? []),
  ]);

  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    // Manual escape hatch: `envy-ignore` here or on the previous line
    // suppresses everything on this line, including known-pattern matches.
    if (IGNORE_COMMENT_RE.test(line)) return;
    if (index > 0 && IGNORE_COMMENT_RE.test(lines[index - 1] ?? '')) return;

    const lineNumber = index + 1;
    // Spans already claimed by a pattern match, so the entropy fallback
    // doesn't report the same value twice.
    const claimed: Array<[start: number, end: number]> = [];

    for (const { name, pattern } of patterns) {
      const globalPattern = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');
      for (const match of line.matchAll(globalPattern)) {
        claimed.push([match.index, match.index + match[0].length]);
        findings.push({
          filePath,
          line: lineNumber,
          redactedValue: redactSecret(match[0]),
          kind: 'known-pattern',
          patternName: name,
        });
      }
    }

    // Doc context is per line, so compute it lazily once per line at most.
    let docContext: boolean | undefined;
    const inDocContext = (): boolean =>
      (docContext ??= hasDocContext(lines, index, lookback, docKeyRe, docDecoratorRe));

    for (const match of line.matchAll(TOKEN_RE)) {
      const token = match[0];
      if (token.length < minLength) continue;
      if (overlapsAny(match.index, match.index + token.length, claimed)) continue;
      if (isLikelyBenign(token)) continue;
      if (shannonEntropy(token) < threshold) continue;
      if (inDocContext()) continue;

      findings.push({
        filePath,
        line: lineNumber,
        redactedValue: redactSecret(token),
        kind: 'high-entropy',
      });
    }
  });

  return findings;
}

/**
 * Reads a file from disk and scans it for potential secrets.
 *
 * @param filePath - Path of the file to scan.
 * @param config - Optional risk-detector overrides.
 * @returns All potential secrets found in the file.
 */
export async function scanFileForSecrets(
  filePath: string,
  config: EnvyConfig = {},
): Promise<SecretFinding[]> {
  const content = await readFile(filePath, 'utf8');
  return scanContentForSecrets(content, filePath, config);
}

/**
 * Scans several files for potential secrets and concatenates the findings.
 *
 * @param filePaths - Paths of the files to scan.
 * @param config - Optional risk-detector overrides.
 * @returns Findings from all files, in the order the files were given.
 */
export async function scanFilesForSecrets(
  filePaths: string[],
  config: EnvyConfig = {},
): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  for (const filePath of filePaths) {
    findings.push(...(await scanFileForSecrets(filePath, config)));
  }
  return findings;
}

function overlapsAny(start: number, end: number, spans: Array<[number, number]>): boolean {
  return spans.some(([s, e]) => start < e && end > s);
}

/** Matches `key:`, `'key':`, or `"key":` for any doc-context key. */
function buildDocKeyRegExp(keys: string[]): RegExp {
  return new RegExp(`["']?\\b(?:${keys.map(escapeRegExp).join('|')})\\b["']?\\s*:`, 'i');
}

/** Matches a decorator call like `@ApiProperty(` for any doc decorator. */
function buildDocDecoratorRegExp(names: string[]): RegExp {
  return new RegExp(`@(?:${names.map(escapeRegExp).join('|')})\\s*\\(`);
}

/**
 * Returns true when the token's line, or any of the `lookback` lines above
 * it, contains a doc-context key or doc decorator. Cheap by construction:
 * two precompiled regexes over at most `lookback + 1` already-split lines.
 */
function hasDocContext(
  lines: string[],
  index: number,
  lookback: number,
  keyRe: RegExp,
  decoratorRe: RegExp,
): boolean {
  const start = Math.max(0, index - lookback);
  for (let i = start; i <= index; i++) {
    const line = lines[i] ?? '';
    if (keyRe.test(line) || decoratorRe.test(line)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filters out tokens that are long but clearly not secrets. Purely alphabetic
 * tokens (identifiers, camelCase names, words) are skipped — real machine-
 * generated secrets virtually always mix in digits.
 */
function isLikelyBenign(token: string): boolean {
  return /^[A-Za-z]+$/.test(token);
}
