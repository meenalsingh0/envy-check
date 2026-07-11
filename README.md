# envy-check

[![npm version](https://img.shields.io/npm/v/envy-check)](https://www.npmjs.com/package/envy-check)
[![npm downloads](https://img.shields.io/npm/dw/envy-check)](https://www.npmjs.com/package/envy-check)
[![license](https://img.shields.io/npm/l/envy-check)](LICENSE)

Scan JS/TS codebases for environment-variable problems — undeclared variables, dead declarations, and committed secrets — in one command.

## Why Envy

Environment variables are the loosest contract in a JavaScript project: code reads `process.env.API_KEY` in one file, `.env.example` declares it (or doesn't) in another, and nothing checks that the two agree. The result is the classic "works on my machine" failure — a deploy crashes because a variable was never documented, or an `.env.example` bloats with variables nobody reads anymore. Worse, real secrets occasionally get committed to tracked files where they live forever in git history.

This project exists partly because of a false alarm it raised on itself: an early test run flagged a sample JWT sitting inside a `@ApiProperty({ example: '...' })` Swagger decorator as a leaked secret. A base64-encoded example token is statistically indistinguishable from a real one to a naive entropy check — which is a good reminder that most secret scanners are guessing, and worth building carefully.

Envy statically analyzes your code and your dotenv files, diffs them, and flags likely secrets before they ship.

## Install & run

```sh
npx envy-check scan            # scan the current directory
npx envy-check scan ./apps/web # scan a subdirectory (monorepos work fine)
```

Or install it:

```sh
npm install --save-dev envy-check
```

## Sample output

```
2 missing, 1 unused, 1 risky

Missing (used in code, not declared in any .env file)
┌────────────────┬────────────┬──────┬─────────────────┐
│ Variable       │ File       │ Line │ Source          │
├────────────────┼────────────┼──────┼─────────────────┤
│ SESSION_SECRET │ src/app.ts │ 12   │ process.env     │
│ VITE_API_URL   │ src/api.ts │ 3    │ import.meta.env │
└────────────────┴────────────┴──────┴─────────────────┘

Unused (declared but never referenced in code)
┌────────────┬──────────────┬──────┐
│ Variable   │ Declared in  │ Line │
├────────────┼──────────────┼──────┤
│ OLD_FLAG   │ .env.example │ 8    │
└────────────┴──────────────┴──────┘

Potential secrets in tracked files
┌───────────────────┬───────────────┬──────┬──────────────┐
│ Detection         │ File          │ Line │ Preview      │
├───────────────────┼───────────────┼──────┼──────────────┤
│ stripe-secret-key │ src/pay.ts    │ 4    │ sk_l******** │
└───────────────────┴───────────────┴──────┴──────────────┘

Scanned 14 source file(s), 2 .env file(s), risk-checked 31 file(s).
```

Secret values are **always redacted** — only the first 4 characters are ever shown, and the redaction hides the value's length.

## Usage

```
envy scan [path] [options]
```

| Flag        | Effect                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `--json`    | Machine-readable output (documented, versioned schema)                 |
| `--no-risk` | Skip secret detection                                                  |
| `--strict`  | Exit with code 1 if any missing or risky variables are found (for CI) |

**Exit codes:** `0` clean or non-strict, `1` strict mode with findings, `2` error (e.g. bad path). Files that fail to parse don't abort the scan — they are skipped with a warning on stderr and listed in the output (`skippedFiles` in JSON) so you know they weren't analyzed.

## What it detects

1. **Missing** — `process.env.X` / `import.meta.env.X` used in code (dot access, `env['X']`, destructuring) but declared in no `.env`, `.env.example`, or `.env.*` file. Framework-prefixed names (`NEXT_PUBLIC_*`, `VITE_*`, `REACT_APP_*`) are ordinary variable names.
2. **Unused** — declared in a dotenv file but never referenced in code.
3. **Risky** — values in tracked (non-gitignored) files that match known secret formats (Stripe, AWS, GitHub, GitLab, Slack, Google) or exceed a Shannon-entropy threshold. Lockfiles, binaries, and `.env` files themselves are excluded.

### Reducing secret-scan false positives

Two mechanisms keep documentation and sample data out of the risky list:

- **Doc-context detection (automatic).** A high-entropy token is skipped when its line — or up to 5 lines above it — contains a documentation key (`example:`, `sample:`, `placeholder:`, `default:`, `mock:`, `dummy:`, `fixture:`, quoted JSON forms too) or a Swagger/OpenAPI doc decorator (`@ApiProperty(`, `@ApiResponse(`, …). So a JWT in `@ApiProperty({ example: 'eyJh…' })` is no longer flagged. This applies **only** to the entropy heuristic — known secret formats like `sk_live_…` are always reported, because a real Stripe key is a leak no matter what it's labeled. The key/decorator lists and lookback distance are extendable via `EnvyConfig` (`docContextKeys`, `docDecorators`, `contextLookbackLines`).

- **`envy-ignore` comment (manual escape hatch).** For anything the heuristics don't catch, add an `envy-ignore` comment on the flagged line or the line directly above it — all findings on that line are suppressed. Works in any comment style:

  ```ts
  const demoToken = 'gh0st-t0ken-f0r-the-d0cs-0nly'; // envy-ignore
  # envy-ignore   (the next line is suppressed too)
  ```

  Use it sparingly — it silences known-pattern matches as well, so an ignored line is fully trusted.

`.gitignore` files are honored at every directory level; `node_modules`, `.git`, and common build-output directories (`dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`) are always skipped. Dotenv files are still found even when gitignored (which they usually are).

## GitHub Action usage

Envy ships as a GitHub Action that scans every pull request and posts (or updates — never spams) a single summary comment with the findings:

```yaml
# .github/workflows/envy.yml
name: Envy
on: pull_request

permissions:
  contents: read
  pull-requests: write # required for the PR comment

jobs:
  envy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: meenalsingh0/envy-check@v1
        with:
          path: . # directory to scan (default '.')
          fail-on-risky: 'true' # fail the check on potential secrets (default true)
          fail-on-missing: 'false' # fail on undeclared variables (default false)
```

The comment lists missing, unused, and risky variables in markdown tables with `file:line` references; secret previews are always redacted. Unused variables are reported but never fail the check. See [.github/workflows/envy-self-check.yml](.github/workflows/envy-self-check.yml) for the dogfooding setup this repo runs on itself.

## Known limitations

- **Secret detection is text-based, on purpose.** The risk detector reads raw lines with regexes — never an AST — so it can scan _any_ tracked file type (YAML, JSON, Markdown, configs), not just parseable JS/TS. The cost of that choice is no real syntactic understanding: false-positive reduction relies on **nearby-line heuristics** — documentation property keys (`example:`, `placeholder:`, …), doc decorators (`@ApiProperty(`, …) within a few lines above the token, and `envy-ignore` suppression comments. This is a heuristic, not a guarantee: unusual formatting (an example value far below its key, generated single-line files, unconventional decorator layouts) can still produce false positives — use `envy-ignore` for those — and, conversely, a real secret placed near a doc key will be skipped by the entropy check (known-format secrets like `sk_live_…` are always flagged regardless).
- **Entropy has blind spots.** Short secrets, low-entropy passwords, and hex-only strings can score below the threshold; the entropy check is a fallback, not a complete secret scanner.
- **Dynamic env access isn't tracked.** `process.env[someVariable]` can't be resolved statically and is ignored by the usage extractor.

## Development

```sh
npm install
npm test          # unit + end-to-end tests (Vitest)
npm run build     # compile to dist/
npm run lint      # type-checked ESLint
```

## License

[MIT](LICENSE)
