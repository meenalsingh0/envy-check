export { walk } from './core/walker.js';
export { extractEnvUsages, extractEnvUsagesFromFile } from './core/extractor.js';
export { parseEnvContent, parseEnvFile, parseEnvFiles } from './core/envParser.js';
export { diffEnv } from './core/diff.js';
export {
  scanContentForSecrets,
  scanFileForSecrets,
  scanFilesForSecrets,
  shannonEntropy,
  redactSecret,
  DOC_CONTEXT_KEYS,
  DOC_DECORATORS,
} from './core/riskDetector.js';
export { scan, run, EnvyError } from './cli.js';
export { formatReport, toJson } from './reporter.js';
export type {
  EnvUsage,
  EnvDeclaration,
  WalkOptions,
  DiffResult,
  MatchedVariable,
  SecretFinding,
  SecretPattern,
  EnvyConfig,
  OutputSchema,
  SkippedFile,
} from './types.js';
