/**
 * A single reference to an environment variable found in source code,
 * e.g. `process.env.API_KEY` or `import.meta.env.VITE_URL`.
 */
export interface EnvUsage {
  /** Name of the referenced environment variable. */
  name: string;
  /** Absolute path of the file containing the reference. */
  filePath: string;
  /** 1-based line number of the reference. */
  line: number;
  /** Which runtime object the variable was read from. */
  source: 'process.env' | 'import.meta.env';
}

/**
 * A variable declared in a dotenv-style file, e.g. `API_KEY=abc` in `.env`.
 */
export interface EnvDeclaration {
  /** Name of the declared variable. */
  name: string;
  /** Absolute path of the .env file declaring it. */
  filePath: string;
  /** 1-based line number of the declaration. */
  line: number;
}

/** A variable that is both declared in a .env file and referenced in code. */
export interface MatchedVariable {
  /** Name of the variable. */
  name: string;
  /** The winning declaration for this name. */
  declaration: EnvDeclaration;
  /** Every code reference to this name. */
  usages: EnvUsage[];
}

/** Result of diffing code usages against .env declarations. */
export interface DiffResult {
  /** Usages of variables that are not declared in any .env file. */
  missing: EnvUsage[];
  /** Declarations that are never referenced in code. */
  unused: EnvDeclaration[];
  /** Variables that are both declared and used. */
  matched: MatchedVariable[];
  /** Distinct variable-name counts per category. */
  counts: {
    missing: number;
    unused: number;
    matched: number;
  };
}

/** A named regex describing a known secret format. */
export interface SecretPattern {
  /** Human-readable identifier, e.g. `stripe-live-key`. */
  name: string;
  /** Pattern matching the secret. Must not use the `g` flag statefully — it is applied per line. */
  pattern: RegExp;
}

/** A potential committed secret found in a tracked file. */
export interface SecretFinding {
  /** Absolute path of the file containing the value. */
  filePath: string;
  /** 1-based line number of the value. */
  line: number;
  /**
   * Redacted preview: first 4 characters followed by a fixed run of
   * asterisks. The full value is never stored or returned.
   */
  redactedValue: string;
  /** How the value was detected. */
  kind: 'known-pattern' | 'high-entropy';
  /** Name of the matching pattern when `kind` is `known-pattern`. */
  patternName?: string;
}

/**
 * User-facing configuration. Only the risk-detector options are consumed so
 * far; config-file loading will wire the rest up later.
 */
export interface EnvyConfig {
  /**
   * Shannon-entropy threshold (bits per character) above which a token is
   * flagged as a potential secret. Default: 4.0.
   */
  entropyThreshold?: number;
  /** Minimum token length considered by the entropy heuristic. Default: 20. */
  minTokenLength?: number;
  /** Extra secret formats to detect in addition to the built-in ones. */
  customSecretPatterns?: SecretPattern[];
  /**
   * Extra documentation-context keys (matched case-insensitively as `key:` /
   * `"key":`) merged with the built-in `DOC_CONTEXT_KEYS`. A high-entropy
   * token near one of these keys is treated as sample data, not a secret.
   */
  docContextKeys?: string[];
  /**
   * Extra decorator names (matched as `@Name(`) merged with the built-in
   * `DOC_DECORATORS`. High-entropy tokens near these are skipped.
   */
  docDecorators?: string[];
  /**
   * How many lines above a high-entropy token to search for doc context.
   * Default: 5. Applies only to the entropy heuristic, never to
   * known-format pattern matches.
   */
  contextLookbackLines?: number;
}

/** Options accepted by the file walker. */
export interface WalkOptions {
  /**
   * File extensions to include (with leading dot, e.g. `['.ts', '.tsx']`).
   * When omitted, every file not excluded by ignore rules is returned.
   */
  extensions?: string[];
  /** Directory names to always skip, in addition to `node_modules` and `.git`. */
  skipDirs?: string[];
  /**
   * Whether to honor .gitignore files (default true). Set to false to also
   * find ignored files — e.g. .env files, which are usually gitignored but
   * still need to be read for declarations.
   */
  respectGitignore?: boolean;
}

/** A source file the scan could not parse and therefore did not analyze. */
export interface SkippedFile {
  /** Absolute path of the skipped file. */
  filePath: string;
  /** Short, single-line description of the parse error. */
  reason: string;
}

/**
 * Machine-readable result of a full scan, emitted by `envy scan --json`.
 * The schema is versioned so downstream tooling can detect breaking changes.
 */
export interface OutputSchema {
  /** Schema version; incremented on breaking changes to this shape. */
  version: 1;
  /** Absolute path of the scanned directory. */
  scannedPath: string;
  /** What was scanned. */
  stats: {
    /** Number of source files parsed for env-var usages. */
    sourceFilesScanned: number;
    /** Number of dotenv files parsed for declarations. */
    envFilesFound: number;
    /** Number of tracked files scanned for secrets (0 when risk scan is off). */
    filesRiskScanned: number;
  };
  /** Distinct-name counts per category; `risky` counts individual findings. */
  counts: {
    missing: number;
    unused: number;
    matched: number;
    risky: number;
  };
  /** Usages of variables not declared in any .env file. */
  missing: EnvUsage[];
  /** Declarations never referenced in code. */
  unused: EnvDeclaration[];
  /** Variables both declared and used. */
  matched: MatchedVariable[];
  /** Potential committed secrets (values always redacted). */
  risks: SecretFinding[];
  /**
   * Source files that could not be parsed and were skipped (count =
   * `skippedFiles.length`). Their env-var usages are NOT included above.
   */
  skippedFiles: SkippedFile[];
}
