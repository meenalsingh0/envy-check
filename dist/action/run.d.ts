import type { OutputSchema } from '../types.js';
/**
 * Hidden HTML marker embedded in every Envy PR comment so a later run can
 * find and update its own comment instead of posting a new one.
 */
export declare const COMMENT_MARKER = "<!-- envy-check-report -->";
/** Resolved action inputs. */
export interface ActionInputs {
    /** Directory to scan, relative to the workspace. */
    path: string;
    /** Fail the check when potential secrets are found. */
    failOnRisky: boolean;
    /** Fail the check when undeclared variables are found. */
    failOnMissing: boolean;
}
/** The subset of the GitHub issues API the action needs (injectable for tests). */
export interface IssueCommentApi {
    listComments(params: {
        owner: string;
        repo: string;
        issue_number: number;
        per_page: number;
    }): Promise<{
        data: Array<{
            id: number;
            body?: string | null;
        }>;
    }>;
    createComment(params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
    }): Promise<unknown>;
    updateComment(params: {
        owner: string;
        repo: string;
        comment_id: number;
        body: string;
    }): Promise<unknown>;
}
/** Identifies the PR a comment should be posted on. */
export interface CommentTarget {
    owner: string;
    repo: string;
    issueNumber: number;
}
/**
 * Renders a scan result as a markdown PR comment: summary line plus one
 * table per non-empty category. Secret values are already redacted by the
 * scanner; this function never receives full secrets.
 *
 * @param schema - Scan result to render.
 * @returns Markdown body starting with the {@link COMMENT_MARKER}.
 */
export declare function buildCommentBody(schema: OutputSchema): string;
/**
 * Decides whether the scan should fail the check, per the `fail-on-*` inputs.
 *
 * @param schema - Scan result.
 * @param inputs - Resolved action inputs.
 * @returns A human-readable failure message, or null if the check passes.
 */
export declare function determineFailure(schema: OutputSchema, inputs: ActionInputs): string | null;
/**
 * Posts the report on a PR, updating the previous Envy comment (identified by
 * {@link COMMENT_MARKER}) when one exists so reruns don't spam the thread.
 *
 * @param api - Issue-comment API (octokit's `rest.issues` in production).
 * @param target - Repository and PR to comment on.
 * @param body - Markdown comment body.
 * @returns Whether a comment was created or an existing one updated.
 */
export declare function upsertComment(api: IssueCommentApi, target: CommentTarget, body: string): Promise<'created' | 'updated'>;
/**
 * Entry logic for the GitHub Action: scans the workspace, comments on the PR
 * (when running in a pull_request context), and sets the exit status from the
 * `fail-on-*` inputs.
 */
export declare function main(): Promise<void>;
