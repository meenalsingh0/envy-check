import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractEnvUsages, extractEnvUsagesFromFile } from '../src/core/extractor.js';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

describe('extractEnvUsages', () => {
  it('finds every supported access pattern in the fixture file', async () => {
    const usages = await extractEnvUsagesFromFile(path.join(FIXTURES, 'usages.ts'));
    const names = usages.map((u) => u.name);

    expect(names).toEqual([
      'API_KEY',
      'DATABASE_URL',
      'SESSION_SECRET',
      'PORT',
      'NODE_ENV',
      'VITE_API_URL',
      'VITE_FLAG',
    ]);
  });

  it('records file path, line number, and source', async () => {
    const filePath = path.join(FIXTURES, 'usages.ts');
    const usages = await extractEnvUsagesFromFile(filePath);

    expect(usages[0]).toEqual({
      name: 'API_KEY',
      filePath,
      line: 3,
      source: 'process.env',
    });
    const viteUsage = usages.find((u) => u.name === 'VITE_API_URL');
    expect(viteUsage).toMatchObject({ line: 8, source: 'import.meta.env' });
  });

  it('handles bracket access with string and template literals', () => {
    const usages = extractEnvUsages(
      "const a = process.env['FOO'];\nconst b = process.env[`BAR`];",
      'test.ts',
    );
    expect(usages.map((u) => u.name)).toEqual(['FOO', 'BAR']);
  });

  it('handles destructuring, including renamed and quoted keys', () => {
    const usages = extractEnvUsages(
      "const { HOST, PORT: p, 'WEIRD-KEY': w, ...rest } = process.env;",
      'test.ts',
    );
    expect(usages.map((u) => u.name)).toEqual(['HOST', 'PORT', 'WEIRD-KEY']);
  });

  it('ignores dynamic access and unrelated member expressions', () => {
    const usages = extractEnvUsages(
      'const k = "X"; process.env[k]; process.env[`${k}`]; other.env.Y; env.Z;',
      'test.ts',
    );
    expect(usages).toEqual([]);
  });

  it('parses JSX files', async () => {
    const usages = await extractEnvUsagesFromFile(path.join(FIXTURES, 'component.jsx'));
    expect(usages.map((u) => u.name)).toEqual(['APP_TITLE', 'VITE_GREETING']);
  });

  it('parses legacy decorator syntax (NestJS/Angular style)', async () => {
    const usages = await extractEnvUsagesFromFile(path.join(FIXTURES, 'decorated.ts'));

    expect(usages.map((u) => u.name)).toEqual(['DATABASE_URL', 'HEALTH_KEY', 'HEALTH_TIMEOUT_MS']);
  });

  it('throws on genuinely malformed source (callers are expected to skip the file)', () => {
    expect(() => extractEnvUsages('const = {{{ not valid ;;;', 'bad.ts')).toThrow();
  });

  it('supports TypeScript-only syntax', () => {
    const usages = extractEnvUsages(
      'const url: string = process.env.URL as string; const x = process.env.TOKEN!;',
      'test.ts',
    );
    expect(usages.map((u) => u.name)).toEqual(['URL', 'TOKEN']);
  });
});
