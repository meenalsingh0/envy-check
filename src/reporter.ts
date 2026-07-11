import path from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { OutputSchema } from './types.js';

/**
 * Serializes a scan result as pretty-printed JSON following the documented
 * {@link OutputSchema} shape.
 *
 * @param schema - Scan result to serialize.
 * @returns JSON string, suitable for piping to other tools.
 */
export function toJson(schema: OutputSchema): string {
  return JSON.stringify(schema, null, 2);
}

/**
 * Formats a scan result for human-readable terminal output: a one-line
 * summary followed by a table per non-empty category. File paths are shown
 * relative to the scanned directory.
 *
 * @param schema - Scan result to format.
 * @returns Multi-line string ready to print (colors auto-disable when not a TTY).
 */
export function formatReport(schema: OutputSchema): string {
  const { stats } = schema;
  const lines: string[] = [];

  lines.push(summaryLine(schema), '');

  if (stats.envFilesFound === 0) {
    lines.push(
      chalk.yellow('No .env files found — every used variable is reported as missing.'),
      '',
    );
  }

  if (schema.missing.length > 0) {
    lines.push(chalk.red.bold('Missing (used in code, not declared in any .env file)'));
    const table = makeTable(['Variable', 'File', 'Line', 'Source']);
    for (const usage of schema.missing) {
      table.push([usage.name, relative(schema, usage.filePath), usage.line, usage.source]);
    }
    lines.push(table.toString(), '');
  }

  if (schema.unused.length > 0) {
    lines.push(chalk.yellow.bold('Unused (declared but never referenced in code)'));
    const table = makeTable(['Variable', 'Declared in', 'Line']);
    for (const decl of schema.unused) {
      table.push([decl.name, relative(schema, decl.filePath), decl.line]);
    }
    lines.push(table.toString(), '');
  }

  if (schema.risks.length > 0) {
    lines.push(chalk.red.bold('Potential secrets in tracked files'));
    const table = makeTable(['Detection', 'File', 'Line', 'Preview']);
    for (const risk of schema.risks) {
      table.push([
        risk.patternName ?? risk.kind,
        relative(schema, risk.filePath),
        risk.line,
        risk.redactedValue,
      ]);
    }
    lines.push(table.toString(), '');
  }

  if (schema.skippedFiles.length > 0) {
    lines.push(
      chalk.yellow(
        `⚠ ${schema.skippedFiles.length} file(s) skipped due to parse errors (not analyzed):`,
      ),
    );
    for (const skipped of schema.skippedFiles) {
      lines.push(chalk.yellow(`  - ${relative(schema, skipped.filePath)}: ${skipped.reason}`));
    }
    lines.push('');
  }

  lines.push(
    chalk.dim(
      `Scanned ${stats.sourceFilesScanned} source file(s) ` +
        `(${schema.skippedFiles.length} skipped), ` +
        `${stats.envFilesFound} .env file(s), ` +
        `risk-checked ${stats.filesRiskScanned} file(s).`,
    ),
  );

  return lines.join('\n');
}

function summaryLine(schema: OutputSchema): string {
  const { counts } = schema;
  if (counts.missing === 0 && counts.unused === 0 && counts.risky === 0) {
    return chalk.green('✔ All clean — no missing, unused, or risky variables found.');
  }

  const parts = [
    colorCount(counts.missing, 'missing', chalk.red),
    colorCount(counts.unused, 'unused', chalk.yellow),
    colorCount(counts.risky, 'risky', chalk.red),
  ];
  return parts.join(chalk.dim(', '));
}

function colorCount(count: number, label: string, color: typeof chalk.red): string {
  const text = `${count} ${label}`;
  return count > 0 ? color(text) : chalk.dim(text);
}

function makeTable(head: string[]): Table.Table {
  return new Table({ head, style: { head: ['cyan'] } });
}

function relative(schema: OutputSchema, filePath: string): string {
  return path.relative(schema.scannedPath, filePath) || '.';
}
