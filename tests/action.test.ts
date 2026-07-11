import { describe, expect, it, vi } from 'vitest';
import {
  buildCommentBody,
  COMMENT_MARKER,
  determineFailure,
  upsertComment,
  type ActionInputs,
  type IssueCommentApi,
} from '../src/action/run.js';
import type { OutputSchema } from '../src/types.js';

function schemaWith(overrides: Partial<OutputSchema> = {}): OutputSchema {
  return {
    version: 1,
    scannedPath: '/repo',
    stats: { sourceFilesScanned: 10, envFilesFound: 1, filesRiskScanned: 20 },
    counts: { missing: 0, unused: 0, matched: 0, risky: 0 },
    missing: [],
    unused: [],
    matched: [],
    risks: [],
    skippedFiles: [],
    ...overrides,
  };
}

const FINDINGS = schemaWith({
  counts: { missing: 1, unused: 1, matched: 0, risky: 1 },
  missing: [{ name: 'API_KEY', filePath: '/repo/src/app.ts', line: 3, source: 'process.env' }],
  unused: [{ name: 'OLD_FLAG', filePath: '/repo/.env.example', line: 8 }],
  risks: [
    {
      filePath: '/repo/src/pay.ts',
      line: 4,
      redactedValue: 'sk_l********',
      kind: 'known-pattern',
      patternName: 'stripe-secret-key',
    },
  ],
});

const INPUTS: ActionInputs = { path: '.', failOnRisky: true, failOnMissing: false };

describe('buildCommentBody', () => {
  it('starts with the marker and includes all three category tables', () => {
    const body = buildCommentBody(FINDINGS);

    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('1 missing · 1 unused · 1 risky');
    expect(body).toContain('| `API_KEY` | src/app.ts | 3 | `process.env` |');
    expect(body).toContain('| `OLD_FLAG` | .env.example | 8 |');
    expect(body).toContain('| stripe-secret-key | src/pay.ts | 4 | `sk_l********` |');
  });

  it('notes skipped files so readers know the analysis is incomplete', () => {
    const body = buildCommentBody(
      schemaWith({
        skippedFiles: [{ filePath: '/repo/src/broken.ts', reason: 'Unexpected token' }],
      }),
    );
    expect(body).toContain('1 file(s) could not be parsed');
  });

  it('renders an all-clean body when there are no findings', () => {
    const body = buildCommentBody(schemaWith());

    expect(body).toContain('All clean');
    expect(body).not.toContain('| Variable |');
  });

  it('truncates very long tables instead of posting hundreds of rows', () => {
    const missing = Array.from({ length: 40 }, (_, i) => ({
      name: `VAR_${i}`,
      filePath: '/repo/src/app.ts',
      line: i + 1,
      source: 'process.env' as const,
    }));
    const body = buildCommentBody(
      schemaWith({ missing, counts: { missing: 40, unused: 0, matched: 0, risky: 0 } }),
    );

    expect(body).toContain('VAR_0');
    expect(body).toContain('…and 15 more.');
    expect(body).not.toContain('VAR_39');
  });
});

describe('determineFailure', () => {
  it('fails on risky findings by default, but not on missing', () => {
    expect(determineFailure(FINDINGS, INPUTS)).toContain('1 potential secret(s)');
    expect(determineFailure(FINDINGS, INPUTS)).not.toContain('missing');
  });

  it('fails on missing when fail-on-missing is enabled', () => {
    const failure = determineFailure(FINDINGS, { ...INPUTS, failOnMissing: true });
    expect(failure).toContain('1 missing environment variable(s)');
    expect(failure).toContain('1 potential secret(s)');
  });

  it('passes when findings exist but the corresponding inputs are off', () => {
    const inputs: ActionInputs = { path: '.', failOnRisky: false, failOnMissing: false };
    expect(determineFailure(FINDINGS, inputs)).toBeNull();
  });

  it('never fails on unused variables alone', () => {
    const schema = schemaWith({
      counts: { missing: 0, unused: 5, matched: 0, risky: 0 },
    });
    expect(determineFailure(schema, { ...INPUTS, failOnMissing: true })).toBeNull();
  });
});

describe('upsertComment', () => {
  const target = { owner: 'acme', repo: 'web', issueNumber: 42 };

  function mockApi(existingComments: Array<{ id: number; body?: string }>) {
    const listComments = vi.fn().mockResolvedValue({ data: existingComments });
    const createComment = vi.fn().mockResolvedValue({});
    const updateComment = vi.fn().mockResolvedValue({});
    const api: IssueCommentApi = { listComments, createComment, updateComment };
    return { api, createComment, updateComment };
  }

  it('creates a new comment when no Envy comment exists', async () => {
    const { api, createComment, updateComment } = mockApi([
      { id: 1, body: 'unrelated human comment' },
    ]);

    const outcome = await upsertComment(api, target, `${COMMENT_MARKER}\nreport`);

    expect(outcome).toBe('created');
    expect(createComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'web',
      issue_number: 42,
      body: `${COMMENT_MARKER}\nreport`,
    });
    expect(updateComment).not.toHaveBeenCalled();
  });

  it('updates the existing Envy comment instead of posting a duplicate', async () => {
    const { api, createComment, updateComment } = mockApi([
      { id: 7, body: 'unrelated' },
      { id: 9, body: `${COMMENT_MARKER}\nold report` },
    ]);

    const outcome = await upsertComment(api, target, `${COMMENT_MARKER}\nnew report`);

    expect(outcome).toBe('updated');
    expect(updateComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'web',
      comment_id: 9,
      body: `${COMMENT_MARKER}\nnew report`,
    });
    expect(createComment).not.toHaveBeenCalled();
  });

  it('handles comments with missing bodies', async () => {
    const { api } = mockApi([{ id: 3 }]);
    const outcome = await upsertComment(api, target, `${COMMENT_MARKER}\nreport`);
    expect(outcome).toBe('created');
  });
});
