import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { WalkOptions } from '../types.js';

const ALWAYS_SKIPPED_DIRS = new Set(['node_modules', '.git']);

/** An ignore matcher paired with the directory its .gitignore lives in. */
interface IgnoreScope {
  matcher: Ignore;
  /** Absolute directory the .gitignore patterns are relative to. */
  base: string;
}

/**
 * Recursively collects file paths under a directory, honoring `.gitignore`
 * files at every level (patterns apply relative to the directory containing
 * them, as git does) unless `respectGitignore` is false. `node_modules` and
 * `.git` are always skipped.
 *
 * @param rootDir - Absolute or relative path of the directory to walk.
 * @param options - Optional extension filter, extra directories to skip, and
 *   gitignore handling.
 * @returns Absolute paths of all matching, non-ignored files.
 */
export async function walk(rootDir: string, options: WalkOptions = {}): Promise<string[]> {
  const root = path.resolve(rootDir);
  const skipDirs = new Set([...ALWAYS_SKIPPED_DIRS, ...(options.skipDirs ?? [])]);
  const useGitignore = options.respectGitignore ?? true;
  const files: string[] = [];
  await walkDir(root, [], skipDirs, options.extensions, useGitignore, files);
  return files;
}

async function walkDir(
  dir: string,
  parentScopes: IgnoreScope[],
  skipDirs: Set<string>,
  extensions: string[] | undefined,
  useGitignore: boolean,
  out: string[],
): Promise<void> {
  const scopes = [...parentScopes];
  if (useGitignore) {
    const localIgnore = await readGitignore(dir);
    if (localIgnore) {
      scopes.push({ matcher: localIgnore, base: dir });
    }
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name) || isIgnored(fullPath, scopes, true)) continue;
      await walkDir(fullPath, scopes, skipDirs, extensions, useGitignore, out);
    } else if (entry.isFile()) {
      if (extensions && !extensions.includes(path.extname(entry.name))) continue;
      if (isIgnored(fullPath, scopes, false)) continue;
      out.push(fullPath);
    }
    // Symlinks and other entry types are intentionally skipped to avoid cycles.
  }
}

async function readGitignore(dir: string): Promise<Ignore | null> {
  try {
    const content = await readFile(path.join(dir, '.gitignore'), 'utf8');
    return ignore().add(content);
  } catch {
    return null;
  }
}

function isIgnored(absPath: string, scopes: IgnoreScope[], isDir: boolean): boolean {
  return scopes.some(({ matcher, base }) => {
    // The `ignore` package expects posix-style paths relative to the
    // .gitignore location; directories need a trailing slash so patterns
    // like `dist/` match.
    let rel = path.relative(base, absPath).split(path.sep).join('/');
    if (isDir) rel += '/';
    return matcher.ignores(rel);
  });
}
