import { userStore } from '~/stores/auth';
import { setReaderStack } from '~/utils/wordLookup';

/**
 * Push the hydrated store fingerprint into the browser lookup cache: SSR `applySession` does not rerun merely
 * because Pinia state was restored. Watch for later auth/stack changes so lookup URLs stop reusing stale
 * dictionary responses.
 */
export default defineNuxtPlugin(() => {
  const user = userStore();

  watchEffect(() => setReaderStack(user.shirabeStackFingerprint));
});
