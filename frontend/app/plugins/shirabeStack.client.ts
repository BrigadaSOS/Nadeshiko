import { userStore } from '~/stores/auth';
import { setReaderStack } from '~/utils/wordLookup';

/**
 * Hands the reader's Shirabe stack fingerprint to the word-lookup cache, in the
 * browser.
 *
 * It cannot come from `applySession` alone, and finding that out cost a real
 * bug. For a signed-in reader `applySession` runs only on the SERVER: the client
 * arrives with Pinia's state already restored from the payload (see
 * `plugins/identity-auth.ts`), so the action never runs a second time. The
 * fingerprint lives in a module variable rather than in that state, so it made
 * the trip on the server and was simply absent in the browser -- which is where
 * every lookup URL is actually built.
 *
 * The failure was silent and looked like something else entirely: with no
 * fingerprint the URL is byte-identical to the one from before this existed, and
 * the response is `private, max-age=86400`, so the browser answered every word
 * out of its own day-old cache. A reader who had just changed their dictionaries
 * kept being shown definitions from the ones they removed, with no request made
 * and nothing logged anywhere.
 *
 * `watchEffect` rather than a read, so this is independent of plugin order and
 * follows a reader who signs in, signs out, or has their stack change under them
 * mid-session (`fetchWord` re-keys on drift and writes the same variable).
 */
export default defineNuxtPlugin(() => {
  const user = userStore();

  watchEffect(() => setReaderStack(user.shirabeStackFingerprint));
});
