import { stat } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { diffEnv } from './core/diff.js';
import { parseEnvFiles } from './core/envParser.js';
import { extractEnvUsagesFromFile } from './core/extractor.js';
import { scanFilesForSecrets } from './core/riskDetector.js';
import { walk } from './core/walker.js';
import { formatReport, toJson } from './reporter.js';
import type { EnvUsage, EnvyConfig, OutputSchema, SkippedFile } from './types.js';

/** Error whose message is safe to show users directly (no stack trace). */
export class EnvyError extends Error {}

const SOURCE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const ENV_FILE_RE = /^\.env(\..+)?$/;

// Build output is generated from source, so scanning it only produces
// duplicate or bundler-injected noise (e.g. process.env reads inside
// vendored dependencies) — skipped even when not gitignored.
const BUILD_OUTPUT_DIRS = ['dist', 'build', 'out', 'coverage', '.next', '.nuxt'];

// Files whose contents are machine-generated noise for secret scanning:
// lockfiles are full of high-entropy integrity hashes.
const RISK_SKIP_BASENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
]);
const RISK_SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.zip',
  '.gz',
  '.pdf',
  '.exe',
  '.dll',
  '.map',
]);

/** Behavior toggles for a scan, derived from CLI flags. */
export interface ScanFlags {
  /** Whether to run secret detection (the `--no-risk` flag disables it). */
  risk: boolean;
}

/**
 * Runs a full scan of a directory: extracts env-var usages from source files,
 * parses declarations from dotenv files (found even when gitignored), diffs
 * the two, and optionally scans tracked files for committed secrets.
 *
 * Files that fail to parse are skipped with a warning on stderr and listed in
 * the result's `skippedFiles` — a single bad file never aborts the scan.
 *
 * @param targetPath - Directory to scan (absolute or relative).
 * @param flags - Behavior toggles derived from CLI flags.
 * @param config - Optional risk-detector overrides.
 * @returns The full scan result in the documented output schema.
 * @throws {EnvyError} If the path does not exist or is not a directory.
 */
export async function scan(
  targetPath: string,
  flags: ScanFlags = { risk: true },
  config: EnvyConfig = {},
): Promise<OutputSchema> {
  const root = path.resolve(targetPath);
  await assertDirectory(root);

  // Tracked (non-gitignored) files: used for source extraction and risk scan.
  const trackedFiles = await walk(root, { skipDirs: BUILD_OUTPUT_DIRS });
  const sourceFiles = trackedFiles.filter((f) => SOURCE_EXTENSIONS.includes(path.extname(f)));

  // Dotenv files are typically gitignored, so this walk ignores .gitignore.
  const allFiles = await walk(root, { respectGitignore: false, skipDirs: BUILD_OUTPUT_DIRS });
  const envFiles = allFiles.filter((f) => ENV_FILE_RE.test(path.basename(f)));

  const usages: EnvUsage[] = [];
  const skippedFiles: SkippedFile[] = [];
  for (const file of sourceFiles) {
    try {
      usages.push(...(await extractEnvUsagesFromFile(file)));
    } catch (error) {
      // Keep only the first line — Babel errors append code frames.
      const reason = (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
      skippedFiles.push({ filePath: file, reason });
      console.error(
        chalk.yellow(`⚠ Skipped ${path.relative(root, file)}: parse error - ${reason}`),
      );
    }
  }

  const declarations = await parseEnvFiles(envFiles);
  const diff = diffEnv(usages, declarations);

  const riskFiles = flags.risk ? trackedFiles.filter(isRiskScannable) : [];
  const risks = await scanFilesForSecrets(riskFiles, config);

  return {
    version: 1,
    scannedPath: root,
    stats: {
      sourceFilesScanned: sourceFiles.length,
      envFilesFound: envFiles.length,
      filesRiskScanned: riskFiles.length,
    },
    counts: { ...diff.counts, risky: risks.length },
    missing: diff.missing,
    unused: diff.unused,
    matched: diff.matched,
    risks,
    skippedFiles,
  };
}

/**
 * Builds and executes the CLI for the given argv.
 *
 * @param argv - Full process argv (including the `node` and script entries).
 * @returns Process exit code: 0 for clean or non-strict runs, 1 when
 *   `--strict` finds missing or risky variables, 2 on errors.
 */
export async function run(argv: string[]): Promise<number> {
  let exitCode = 0;

  const program = new Command()
    .name('envy')
    .description('Scan JS/TS codebases for undeclared, unused, and leaked environment variables')
    .version('0.1.0');

  program
    .command('scan')
    .argument('[path]', 'directory to scan', '.')
    .description('scan a directory for env-var problems')
    .option('--json', 'output machine-readable JSON', false)
    .option('--no-risk', 'skip secret detection')
    .option('--strict', 'exit with code 1 if any missing or risky variables are found', false)
    .action(async (targetPath: string, opts: { json: boolean; risk: boolean; strict: boolean }) => {
      const schema = await scan(targetPath, { risk: opts.risk });
      console.log(opts.json ? toJson(schema) : formatReport(schema));
      if (opts.strict && (schema.counts.missing > 0 || schema.counts.risky > 0)) {
        exitCode = 1;
      }
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof EnvyError) {
      console.error(chalk.red(`envy: ${error.message}`));
    } else {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`envy: unexpected error: ${reason}`));
    }
    return 2;
  }
  return exitCode;
}

async function assertDirectory(root: string): Promise<void> {
  let stats;
  try {
    stats = await stat(root);
  } catch {
    throw new EnvyError(`Path not found: ${root}`);
  }
  if (!stats.isDirectory()) {
    throw new EnvyError(`Not a directory: ${root}`);
  }
}

function isRiskScannable(filePath: string): boolean {
  const base = path.basename(filePath);
  if (RISK_SKIP_BASENAMES.has(base)) return false;
  if (ENV_FILE_RE.test(base)) return false; // .env files are supposed to hold secrets
  if (base.endsWith('.min.js')) return false;
  return !RISK_SKIP_EXTENSIONS.has(path.extname(base));
}
