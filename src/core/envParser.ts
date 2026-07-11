import { readFile } from 'node:fs/promises';
import type { EnvDeclaration } from '../types.js';

// KEY must start with a letter or underscore; `export ` prefix is allowed
// (bash-compatible dotenv files).
const DECLARATION_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * Parses dotenv-style file content into the variables it declares.
 * Blank lines and `#` comments are skipped; values are not interpreted —
 * only the declared names matter for scanning.
 *
 * @param content - Raw text of a .env file.
 * @param filePath - Path recorded on each declaration (not read from disk).
 * @returns Map from variable name to its declaration. If a name is declared
 *   more than once, the last occurrence wins (matching dotenv semantics).
 */
export function parseEnvContent(content: string, filePath: string): Map<string, EnvDeclaration> {
  const declarations = new Map<string, EnvDeclaration>();

  content.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;

    const match = DECLARATION_RE.exec(rawLine);
    if (match?.[1]) {
      declarations.set(match[1], { name: match[1], filePath, line: index + 1 });
    }
  });

  return declarations;
}

/**
 * Reads a dotenv file from disk and parses its declarations.
 *
 * @param filePath - Path of the .env / .env.example / .env.local file.
 * @returns Map from variable name to its declaration.
 */
export async function parseEnvFile(filePath: string): Promise<Map<string, EnvDeclaration>> {
  const content = await readFile(filePath, 'utf8');
  return parseEnvContent(content, filePath);
}

/**
 * Parses several dotenv files and merges their declarations into one map.
 * Later files in the list override earlier ones for duplicate names.
 *
 * @param filePaths - Paths of the dotenv files to parse, in precedence order.
 * @returns Merged map from variable name to the winning declaration.
 */
export async function parseEnvFiles(filePaths: string[]): Promise<Map<string, EnvDeclaration>> {
  const merged = new Map<string, EnvDeclaration>();
  for (const filePath of filePaths) {
    for (const [name, decl] of await parseEnvFile(filePath)) {
      merged.set(name, decl);
    }
  }
  return merged;
}
