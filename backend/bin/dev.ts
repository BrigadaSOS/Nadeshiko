/**
 * Watch-mode entry. `main.ts` statically imports `generated/*`, so a missing
 * tree is an uncaught ERR_MODULE_NOT_FOUND and Node --watch gives up: the
 * files that will reappear were never added to the watch set.
 *
 * This file has no generated import. It waits for the marker `generate:api`
 * writes last, then loads the app. Deleting generated/ becomes a pause
 * instead of a dead process you have to Ctrl-C.
 */
import { defaultGeneratedDir, waitForGenerated } from './lib/generatedReady';

const generatedDir = defaultGeneratedDir();
let waited = false;

await waitForGenerated(generatedDir, {
  onWaiting: () => {
    waited = true;
    process.stderr.write('[dev] generated/ is missing or still being written. Waiting for generate:api to finish...\n');
  },
});

if (waited) {
  process.stderr.write('[dev] generated/ is ready, starting.\n');
}

await import('../main.ts');
