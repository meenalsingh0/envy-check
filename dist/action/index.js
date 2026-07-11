import * as core from '@actions/core';
import { main } from './run.js';
// Bundle entry point for the GitHub Action (see action.yml).
main().catch((error) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
});
//# sourceMappingURL=index.js.map