import { execSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { OutputSchema } from '../src/types.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = path.join(ROOT, 'bin', 'envy.js');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');

// The fixture secret is fabricated; asserting it never appears in output.
const FAKE_STRIPE_KEY = 'sk_live_FAKEfake1234567890';

function runCli(...args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  // The bin entry runs the compiled output, so build once up front.
  execSync('npx tsc', { cwd: ROOT, stdio: 'inherit' });
}, 120_000);

describe('envy scan (end-to-end)', () => {
  it('reports fixture problems and exits 0 without --strict', () => {
    const { code, stdout } = runCli('scan', FIXTURES);

    expect(code).toBe(0);
    expect(stdout).toContain('8 missing, 2 unused, 4 risky');
    expect(stdout).toContain('SESSION_SECRET'); // missing
    expect(stdout).toContain('EMPTY_VALUE'); // unused
    expect(stdout).toContain('stripe-secret-key'); // risk
  });

  it('skips an unparseable file with a warning instead of crashing', () => {
    const { code, stdout, stderr } = runCli('scan', FIXTURES);

    expect(code).toBe(0); // the scan completes despite malformed.ts
    expect(stderr).toContain('Skipped');
    expect(stderr).toContain('malformed.ts');
    expect(stderr).toContain('parse error');
    expect(stdout).toContain('1 file(s) skipped due to parse errors');
    expect(stdout).toContain('HEALTH_KEY'); // findings from other files still present
  });

  it('exits 1 with --strict when findings exist', () => {
    const { code } = runCli('scan', FIXTURES, '--strict');
    expect(code).toBe(1);
  });

  it('emits the documented JSON schema with --json', () => {
    const { code, stdout } = runCli('scan', FIXTURES, '--json');

    expect(code).toBe(0);
    const schema = JSON.parse(stdout) as OutputSchema;
    expect(schema.version).toBe(1);
    expect(schema.counts).toEqual({ missing: 8, unused: 2, matched: 3, risky: 4 });
    expect(schema.stats.envFilesFound).toBe(1);
    expect(schema.missing.map((u) => u.name)).toContain('VITE_API_URL');
    expect(schema.unused.map((d) => d.name).sort()).toEqual(['EMPTY_VALUE', 'SPACED_KEY']);
    expect(schema.skippedFiles).toHaveLength(1);
    expect(schema.skippedFiles[0]?.filePath).toContain('malformed.ts');
    expect(schema.skippedFiles[0]?.reason).toBeTruthy();
  });

  it('never prints a full secret, only the redacted preview', () => {
    const text = runCli('scan', FIXTURES);
    const json = runCli('scan', FIXTURES, '--json');

    for (const output of [text.stdout, json.stdout]) {
      expect(output).not.toContain(FAKE_STRIPE_KEY);
      expect(output).toContain('sk_l********');
    }
  });

  it('skips secret detection with --no-risk (still strict on missing vars)', () => {
    const { code, stdout } = runCli('scan', FIXTURES, '--no-risk', '--strict', '--json');

    const schema = JSON.parse(stdout) as OutputSchema;
    expect(schema.counts.risky).toBe(0);
    expect(schema.stats.filesRiskScanned).toBe(0);
    expect(code).toBe(1); // missing vars still trigger strict failure
  });

  it('exits 2 with a helpful message for a bad path', () => {
    const { code, stderr } = runCli('scan', path.join(FIXTURES, 'does-not-exist'));

    expect(code).toBe(2);
    expect(stderr).toContain('Path not found');
    expect(stderr).not.toContain('    at '); // no raw stack trace
  });

  it('handles an empty directory (no .env files, no source) gracefully', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'envy-empty-'));
    try {
      const { code, stdout } = runCli('scan', dir, '--strict');
      expect(code).toBe(0);
      expect(stdout).toContain('All clean');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
