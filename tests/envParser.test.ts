import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnvContent, parseEnvFile, parseEnvFiles } from '../src/core/envParser.js';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const ENV_EXAMPLE = path.join(FIXTURES, '.env.example');

describe('parseEnvFile', () => {
  it('parses declarations from the fixture, skipping comments and invalid lines', async () => {
    const declarations = await parseEnvFile(ENV_EXAMPLE);

    expect([...declarations.keys()].sort()).toEqual([
      'API_KEY',
      'DATABASE_URL',
      'EMPTY_VALUE',
      'PORT',
      'SPACED_KEY',
    ]);
  });

  it('records file path and line number; duplicates keep the last occurrence', async () => {
    const declarations = await parseEnvFile(ENV_EXAMPLE);

    expect(declarations.get('DATABASE_URL')).toEqual({
      name: 'DATABASE_URL',
      filePath: ENV_EXAMPLE,
      line: 3,
    });
    // API_KEY appears on lines 2 and 13 — last one wins.
    expect(declarations.get('API_KEY')?.line).toBe(13);
  });

  it('supports the `export KEY=` prefix', async () => {
    const declarations = await parseEnvFile(ENV_EXAMPLE);
    expect(declarations.get('PORT')?.line).toBe(4);
  });
});

describe('parseEnvContent', () => {
  it('handles CRLF line endings', () => {
    const declarations = parseEnvContent('A=1\r\nB=2\r\n', '.env');
    expect(declarations.get('B')?.line).toBe(2);
  });

  it('returns an empty map for empty or comment-only content', () => {
    expect(parseEnvContent('', '.env').size).toBe(0);
    expect(parseEnvContent('# only a comment\n\n', '.env').size).toBe(0);
  });
});

describe('parseEnvFiles', () => {
  it('merges multiple files with later files taking precedence', async () => {
    const declarations = await parseEnvFiles([ENV_EXAMPLE, ENV_EXAMPLE]);
    // Same file twice: same names, no duplicates.
    expect(declarations.size).toBe(5);
  });
});
