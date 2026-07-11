import type { DiffResult, EnvDeclaration, EnvUsage, MatchedVariable } from '../types.js';

/**
 * Compares environment-variable usages found in code against declarations
 * found in .env files and categorizes every variable as missing (used but
 * never declared), unused (declared but never used), or matched (both).
 *
 * @param usages - Code references collected by the extractor.
 * @param declarations - Declared variables, as produced by the env parser
 *   (map keyed by variable name) or as a plain array.
 * @returns The three categorized lists plus distinct-name counts. `missing`
 *   contains every usage of an undeclared name (so one name may appear
 *   multiple times), while `counts` always counts distinct names.
 */
export function diffEnv(
  usages: EnvUsage[],
  declarations: Map<string, EnvDeclaration> | EnvDeclaration[],
): DiffResult {
  const declarationsByName =
    declarations instanceof Map
      ? declarations
      : new Map(declarations.map((decl) => [decl.name, decl]));

  const usagesByName = new Map<string, EnvUsage[]>();
  for (const usage of usages) {
    const list = usagesByName.get(usage.name);
    if (list) list.push(usage);
    else usagesByName.set(usage.name, [usage]);
  }

  const missing: EnvUsage[] = [];
  const matched: MatchedVariable[] = [];
  let missingNames = 0;

  for (const [name, nameUsages] of usagesByName) {
    const declaration = declarationsByName.get(name);
    if (declaration) {
      matched.push({ name, declaration, usages: nameUsages });
    } else {
      missing.push(...nameUsages);
      missingNames += 1;
    }
  }

  const unused = [...declarationsByName.values()].filter((decl) => !usagesByName.has(decl.name));

  return {
    missing,
    unused,
    matched,
    counts: {
      missing: missingNames,
      unused: unused.length,
      matched: matched.length,
    },
  };
}
