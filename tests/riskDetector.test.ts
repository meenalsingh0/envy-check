import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  redactSecret,
  scanContentForSecrets,
  scanFileForSecrets,
  shannonEntropy,
} from '../src/core/riskDetector.js';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

// All "secrets" in these tests are fabricated.
const FAKE_STRIPE_KEY = 'sk_live_FAKEfake1234567890';
const FAKE_RANDOM_BLOB = 'g7Xq2Lp9Zr4Wt8Vy1Ns6Km3Jh5Fd0Bc';

describe('shannonEntropy', () => {
  it('is 0 for empty and single-character strings', () => {
    expect(shannonEntropy('')).toBe(0);
    expect(shannonEntropy('aaaa')).toBe(0);
  });

  it('is log2(n) for a string of n distinct characters', () => {
    expect(shannonEntropy('abcd')).toBeCloseTo(2);
    expect(shannonEntropy('abcdefgh')).toBeCloseTo(3);
  });

  it('scores random-looking strings higher than English words', () => {
    expect(shannonEntropy(FAKE_RANDOM_BLOB)).toBeGreaterThan(4);
    expect(shannonEntropy('internationalization')).toBeLessThan(4);
  });
});

describe('redactSecret', () => {
  it('keeps only the first 4 characters and hides the length', () => {
    const redacted = redactSecret(FAKE_STRIPE_KEY);
    expect(redacted).toBe('sk_l********');
    expect(redacted).not.toContain('FAKE');
    expect(redacted.length).toBe(12);
  });
});

describe('scanContentForSecrets', () => {
  it('flags a known-format fake secret', () => {
    const findings = scanContentForSecrets(`const key = "${FAKE_STRIPE_KEY}";`, 'app.ts');

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'known-pattern',
      patternName: 'stripe-secret-key',
      line: 1,
      filePath: 'app.ts',
    });
  });

  it('does NOT flag normal short strings', () => {
    const findings = scanContentForSecrets(
      'const greeting = "hello world";\nconst port = 3000;',
      'app.ts',
    );
    expect(findings).toEqual([]);
  });

  it('does NOT flag long camelCase identifiers or paths', () => {
    const findings = scanContentForSecrets(
      'const x = extractEnvironmentUsagesFromEverySingleFile;\nconst p = "/usr/local/share/applications/something";',
      'app.ts',
    );
    expect(findings).toEqual([]);
  });

  it('flags high-entropy strings that match no known pattern', () => {
    const findings = scanContentForSecrets(`const blob = "${FAKE_RANDOM_BLOB}";`, 'app.ts');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('high-entropy');
  });

  it('does not double-report a value as both known-pattern and high-entropy', () => {
    const findings = scanContentForSecrets(
      `token = "ghp_FAKEfakeFAKEfake1234567890abcdef"`,
      'app.ts',
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.patternName).toBe('github-token');
  });

  it('never includes the full secret anywhere in the findings', () => {
    const findings = scanContentForSecrets(
      `a = "${FAKE_STRIPE_KEY}"\nb = "${FAKE_RANDOM_BLOB}"`,
      'app.ts',
    );

    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain(FAKE_STRIPE_KEY);
    expect(serialized).not.toContain(FAKE_RANDOM_BLOB);
    // Only the 4-char prefix survives redaction.
    expect(serialized).not.toContain(FAKE_STRIPE_KEY.slice(0, 5));
    expect(serialized).not.toContain(FAKE_RANDOM_BLOB.slice(0, 5));
  });

  it('respects a custom entropy threshold', () => {
    const content = `blob = "${FAKE_RANDOM_BLOB}"`;
    expect(scanContentForSecrets(content, 'a.ts', { entropyThreshold: 5.5 })).toEqual([]);
    expect(scanContentForSecrets(content, 'a.ts', { entropyThreshold: 4.0 })).toHaveLength(1);
  });

  it('supports custom secret patterns from config', () => {
    const findings = scanContentForSecrets('key = "acme_123456"', 'a.ts', {
      customSecretPatterns: [{ name: 'acme-token', pattern: /\bacme_[0-9]{6}/ }],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'known-pattern', patternName: 'acme-token' });
    expect(findings[0]?.redactedValue).toBe('acme********');
  });
});

describe('doc-context exclusion (high-entropy only)', () => {
  it('skips a high-entropy token under an @ApiProperty example (the Swagger case)', () => {
    const snippet = [
      `@ApiProperty({`,
      `  description: 'Access token for authentication',`,
      `  example:`,
      `    '${FAKE_RANDOM_BLOB}',`,
      `})`,
      `accessToken: string;`,
    ].join('\n');

    expect(scanContentForSecrets(snippet, 'dto.ts')).toEqual([]);
  });

  it('produces zero findings for the originally reported JWT-example snippet, verbatim', () => {
    // The fake JWT header below scores 4.36 bits/char — above the 4.0
    // threshold, so only the doc context keeps it out of the findings.
    const snippet = [
      `@ApiProperty({`,
      `  description: 'Access token for authentication',`,
      `  example:`,
      `    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',`,
      `})`,
      `accessToken: string;`,
    ].join('\n');

    expect(scanContentForSecrets(snippet, 'dto.ts')).toEqual([]);
  });

  it('skips the short one-line form: example key and value on the same line', () => {
    expect(scanContentForSecrets(`example: '${FAKE_RANDOM_BLOB}'`, 'a.ts')).toEqual([]);
  });

  it('still flags a bare high-entropy assignment with no nearby doc context', () => {
    // Not a known-pattern match, so this exercises the entropy path only.
    const findings = scanContentForSecrets(`const apiKey = '${FAKE_RANDOM_BLOB}';`, 'a.ts');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('high-entropy');
    expect(findings[0]?.redactedValue).toBe('g7Xq********');
  });

  it('still flags a known-pattern AWS key sitting right next to an example key', () => {
    const findings = scanContentForSecrets(
      `example: 'AKIAFAKE123456789012'`, // fabricated AKIA key
      'docs.ts',
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'known-pattern', patternName: 'aws-access-key-id' });
  });

  it('skips a token whose own line carries a doc-context key', () => {
    const findings = scanContentForSecrets(`placeholder: "${FAKE_RANDOM_BLOB}"`, 'a.ts');
    expect(findings).toEqual([]);
  });

  it('matches doc keys case-insensitively and in quoted JSON form', () => {
    expect(scanContentForSecrets(`"Example": "${FAKE_RANDOM_BLOB}"`, 'a.json')).toEqual([]);
  });

  it('still flags a token when the doc key is beyond the lookback window', () => {
    const filler = Array.from({ length: 6 }, (_, i) => `const line${i} = ${i};`);
    const content = [`example:`, ...filler, `token = "${FAKE_RANDOM_BLOB}"`].join('\n');

    const findings = scanContentForSecrets(content, 'a.ts');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('high-entropy');
  });

  it('respects a configured lookback distance', () => {
    const content = `example:\nconst a = 1;\ntoken = "${FAKE_RANDOM_BLOB}"`;
    expect(scanContentForSecrets(content, 'a.ts')).toEqual([]);
    expect(scanContentForSecrets(content, 'a.ts', { contextLookbackLines: 1 })).toHaveLength(1);
  });

  it('supports custom doc keys and decorators from config', () => {
    const byKey = scanContentForSecrets(`seedValue: "${FAKE_RANDOM_BLOB}"`, 'a.ts', {
      docContextKeys: ['seedValue'],
    });
    const byDecorator = scanContentForSecrets(`@Docs(\n  "${FAKE_RANDOM_BLOB}"\n)`, 'a.ts', {
      docDecorators: ['Docs'],
    });

    expect(byKey).toEqual([]);
    expect(byDecorator).toEqual([]);
  });

  it('NEVER excludes known-pattern matches, even inside doc context', () => {
    const findings = scanContentForSecrets(
      `@ApiProperty({ example: '${FAKE_STRIPE_KEY}' })`,
      'dto.ts',
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.patternName).toBe('stripe-secret-key');
  });
});

describe('envy-ignore inline suppression', () => {
  it('suppresses all findings on the same line, including known patterns', () => {
    const findings = scanContentForSecrets(
      `key = "${FAKE_STRIPE_KEY}"; blob = "${FAKE_RANDOM_BLOB}"; // envy-ignore`,
      'a.ts',
    );
    expect(findings).toEqual([]);
  });

  it('suppresses findings on the line directly below the comment', () => {
    for (const comment of ['// envy-ignore', '# envy-ignore', '/* envy-ignore */']) {
      const findings = scanContentForSecrets(`${comment}\nkey = "${FAKE_STRIPE_KEY}"`, 'a.ts');
      expect(findings).toEqual([]);
    }
  });

  it('does not reach two lines down, and bare text without a comment marker does not count', () => {
    const twoLinesDown = scanContentForSecrets(
      `// envy-ignore\nconst a = 1;\nkey = "${FAKE_STRIPE_KEY}"`,
      'a.ts',
    );
    expect(twoLinesDown).toHaveLength(1);

    const noMarker = scanContentForSecrets(`envy-ignore key = "${FAKE_STRIPE_KEY}"`, 'a.ts');
    expect(noMarker).toHaveLength(1);
  });
});

describe('scanFileForSecrets', () => {
  it('finds exactly the fake secrets in the fixture file', async () => {
    const filePath = path.join(FIXTURES, 'secrets.txt');
    const findings = await scanFileForSecrets(filePath);

    expect(findings.map((f) => ({ line: f.line, kind: f.kind, name: f.patternName }))).toEqual([
      { line: 2, kind: 'known-pattern', name: 'stripe-secret-key' },
      { line: 3, kind: 'known-pattern', name: 'github-token' },
      { line: 4, kind: 'known-pattern', name: 'aws-access-key-id' },
      { line: 6, kind: 'high-entropy', name: undefined },
    ]);
    expect(findings.every((f) => f.filePath === filePath)).toBe(true);
  });
});
