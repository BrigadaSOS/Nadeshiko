/** Watch-mode entry that waits for `generate:api`’s final marker before loading the app, so a missing generated tree
 * pauses instead of making Node --watch die permanently. */
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
