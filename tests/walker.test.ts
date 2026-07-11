import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { walk } from '../src/core/walker.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'envy-walker-'));
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(path.join(root, '.git'), { recursive: true });

  await writeFile(path.join(root, '.gitignore'), 'dist/\n*.log\n');
  await writeFile(path.join(root, 'src', 'nested', '.gitignore'), 'secret.ts\n');

  await writeFile(path.join(root, 'index.ts'), '');
  await writeFile(path.join(root, 'debug.log'), '');
  await writeFile(path.join(root, 'src', 'app.ts'), '');
  await writeFile(path.join(root, 'src', 'styles.css'), '');
  await writeFile(path.join(root, 'src', 'nested', 'secret.ts'), '');
  await writeFile(path.join(root, 'src', 'nested', 'ok.ts'), '');
  await writeFile(path.join(root, 'dist', 'app.js'), '');
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), '');
  await writeFile(path.join(root, '.git', 'config'), '');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('walk', () => {
  it('returns files while honoring .gitignore at every level', async () => {
    const files = await walk(root);
    const relative = files.map((f) => path.relative(root, f).split(path.sep).join('/')).sort();

    expect(relative).toEqual([
      '.gitignore',
      'index.ts',
      'src/app.ts',
      'src/nested/.gitignore',
      'src/nested/ok.ts',
      'src/styles.css',
    ]);
  });

  it('filters by extension when requested', async () => {
    const files = await walk(root, { extensions: ['.ts'] });
    const relative = files.map((f) => path.relative(root, f).split(path.sep).join('/')).sort();

    expect(relative).toEqual(['index.ts', 'src/app.ts', 'src/nested/ok.ts']);
  });

  it('skips extra directories passed via options', async () => {
    const files = await walk(root, { extensions: ['.ts'], skipDirs: ['src'] });
    const relative = files.map((f) => path.relative(root, f));

    expect(relative).toEqual(['index.ts']);
  });
});
