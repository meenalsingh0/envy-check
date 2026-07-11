import { describe, expect, it } from 'vitest';
import { diffEnv } from '../src/core/diff.js';
import type { EnvDeclaration, EnvUsage } from '../src/types.js';

function usage(name: string, line = 1): EnvUsage {
  return { name, filePath: 'src/app.ts', line, source: 'process.env' };
}

function declaration(name: string, line = 1): EnvDeclaration {
  return { name, filePath: '.env', line };
}

describe('diffEnv', () => {
  it('categorizes variables as missing, unused, or matched', () => {
    const usages = [usage('API_KEY'), usage('MISSING_ONE'), usage('MISSING_ONE', 7)];
    const declarations = [declaration('API_KEY'), declaration('NEVER_USED')];

    const result = diffEnv(usages, declarations);

    expect(result.missing.map((u) => u.name)).toEqual(['MISSING_ONE', 'MISSING_ONE']);
    expect(result.unused.map((d) => d.name)).toEqual(['NEVER_USED']);
    expect(result.matched.map((m) => m.name)).toEqual(['API_KEY']);
  });

  it('counts distinct names, not individual usages', () => {
    const usages = [usage('X'), usage('X', 2), usage('X', 3), usage('Y')];
    const result = diffEnv(usages, []);

    expect(result.missing).toHaveLength(4);
    expect(result.counts).toEqual({ missing: 2, unused: 0, matched: 0 });
  });

  it('accepts the Map produced by the env parser', () => {
    const declarations = new Map([['API_KEY', declaration('API_KEY')]]);
    const result = diffEnv([usage('API_KEY')], declarations);

    expect(result.counts).toEqual({ missing: 0, unused: 0, matched: 1 });
  });

  it('collects all usages of a matched variable', () => {
    const usages = [usage('API_KEY', 1), usage('API_KEY', 9)];
    const result = diffEnv(usages, [declaration('API_KEY', 3)]);

    expect(result.matched[0]?.usages.map((u) => u.line)).toEqual([1, 9]);
    expect(result.matched[0]?.declaration.line).toBe(3);
  });

  it('handles empty inputs', () => {
    const result = diffEnv([], []);
    expect(result).toEqual({
      missing: [],
      unused: [],
      matched: [],
      counts: { missing: 0, unused: 0, matched: 0 },
    });
  });
});
