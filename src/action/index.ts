import * as core from '@actions/core';
import { main } from './run.js';

// Bundle entry point for the GitHub Action (see action.yml).
main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
