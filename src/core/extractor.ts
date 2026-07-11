import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import type { EnvUsage } from '../types.js';

type TraverseFn = typeof babelTraverse.default;

// @babel/traverse is CJS; depending on the loader, the default export is
// either the traverse function itself or the module object wrapping it.
const traverseExport = babelTraverse as unknown as TraverseFn | { default: TraverseFn };
const traverse: TraverseFn =
  typeof traverseExport === 'function' ? traverseExport : traverseExport.default;

/**
 * Parses a JS/TS source string and returns every environment-variable
 * reference it contains. Detects:
 * - `process.env.X` and `import.meta.env.X`
 * - bracket access with a static string: `process.env['X']`, `` process.env[`X`] ``
 * - destructuring: `const { X, Y: alias } = process.env`
 *
 * Dynamic access (e.g. `process.env[someVar]`) cannot be resolved statically
 * and is silently skipped.
 *
 * @param code - Source code to scan.
 * @param filePath - Path recorded on each finding (not read from disk).
 * @returns All env-variable usages found, in source order.
 * @throws {Error} If the source cannot be parsed — callers that scan many
 *   files should catch this and skip the file rather than abort.
 */
export function extractEnvUsages(code: string, filePath: string): EnvUsage[] {
  const ast = parse(code, {
    sourceType: 'module',
    // decorators-legacy (not stage-3 'decorators') matches the
    // experimentalDecorators syntax NestJS/Angular code is written in.
    plugins: ['typescript', 'jsx', 'decorators-legacy'],
  });

  const usages: EnvUsage[] = [];

  traverse(ast, {
    MemberExpression(nodePath: NodePath<t.MemberExpression>) {
      // `process.env.X` — the node's object is the env object.
      const accessSource = envSourceOf(nodePath.node.object);
      if (accessSource) {
        const name = staticPropertyName(nodePath.node);
        if (name) {
          usages.push({ name, filePath, line: lineOf(nodePath.node), source: accessSource });
        }
        return;
      }

      // `const { X } = process.env` — the node itself is the env object,
      // appearing as the right-hand side of a destructuring declaration.
      const envSource = envSourceOf(nodePath.node);
      const parent = nodePath.parent;
      if (envSource && parent.type === 'VariableDeclarator' && parent.id.type === 'ObjectPattern') {
        collectDestructuredNames(parent.id, envSource, filePath, usages);
      }
    },
  });

  return usages;
}

/**
 * Reads a file from disk and extracts its environment-variable usages.
 *
 * @param filePath - Path of the .js/.jsx/.ts/.tsx file to scan.
 * @returns All env-variable usages found in the file.
 */
export async function extractEnvUsagesFromFile(filePath: string): Promise<EnvUsage[]> {
  const code = await readFile(filePath, 'utf8');
  return extractEnvUsages(code, filePath);
}

/**
 * Returns which env object a node refers to (`process.env` /
 * `import.meta.env`), or null if it is neither.
 */
function envSourceOf(node: t.Node): EnvUsage['source'] | null {
  if (node.type !== 'MemberExpression') return null;
  if (staticPropertyName(node) !== 'env') return null;

  const obj = node.object;
  if (obj.type === 'Identifier' && obj.name === 'process') return 'process.env';
  if (obj.type === 'MetaProperty' && obj.meta.name === 'import' && obj.property.name === 'meta') {
    return 'import.meta.env';
  }
  return null;
}

/**
 * Resolves the property name of a member expression when it is statically
 * known: `obj.X`, `obj['X']`, or `` obj[`X`] `` with no interpolation.
 */
function staticPropertyName(node: t.MemberExpression): string | null {
  const prop = node.property;
  if (!node.computed) {
    return prop.type === 'Identifier' ? prop.name : null;
  }
  if (prop.type === 'StringLiteral') return prop.value;
  if (prop.type === 'TemplateLiteral' && prop.expressions.length === 0) {
    return prop.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function collectDestructuredNames(
  pattern: t.ObjectPattern,
  source: EnvUsage['source'],
  filePath: string,
  out: EnvUsage[],
): void {
  for (const prop of pattern.properties) {
    // Rest elements (`...rest`) capture the whole env object, not a named var.
    if (prop.type !== 'ObjectProperty') continue;

    const key = prop.key;
    let name: string | null = null;
    if (!prop.computed && key.type === 'Identifier') name = key.name;
    else if (key.type === 'StringLiteral') name = key.value;

    if (name) {
      out.push({ name, filePath, line: lineOf(prop), source });
    }
  }
}

function lineOf(node: t.Node): number {
  return node.loc?.start.line ?? 0;
}
