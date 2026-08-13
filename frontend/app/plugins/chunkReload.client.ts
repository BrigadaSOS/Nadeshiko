import {
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  decideChunkReload,
  isChunkLoadError,
  parseChunkReloadGuard,
} from '~/utils/chunkReloadGuard';
import { reportError } from '~/utils/reportError';

function readStoredGuard(): string | null {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
  } catch {
    // Safari private mode throws on sessionStorage access. Without persistence
    // every error looks like a first attempt, which still terminates: the reload
    // either fixes the build mismatch or the user stops navigating.
    return null;
  }
}

function persistGuard(value: string): void {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, value);
  } catch {
    // See readStoredGuard.
  }
}

/** How long to wait for a fresh copy of the page before reloading regardless. */
const DOCUMENT_REFRESH_TIMEOUT_MS = 3_000;

/**
 * Replaces this page's entry in the browser's own HTTP cache before reloading
 * onto it.
 *
 * WITHOUT THIS THE RELOAD CAN BE A NO-OP, which is how a recovery that runs
 * correctly still ends at `app:chunk-error-unrecoverable`. `reloadNuxtApp` ends
 * in `window.location.href = path` for any target that is not exactly the
 * current pathname -- a plain navigation, and a plain navigation is served from
 * the HTTP cache. Nadeshiko's edge-cached HTML reaches readers with
 * `Cache-Control: private, max-age=3600` (Cloudflare raising the origin's
 * `no-cache` to the zone's browser minimum), so the reload is handed back the
 * very document whose chunks just 404ed, byte for byte, and fails the same way
 * until the budget runs out.
 *
 * `cache: 'reload'` is the one fetch mode that both ignores the stored entry AND
 * writes what comes back over it, which is what makes the navigation that
 * follows see the new build. Failure is not worth handling: if this cannot
 * reach the network the reload is no worse off than it would have been, so
 * every outcome leads to the same next line.
 */
async function refreshCachedDocument(target: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOCUMENT_REFRESH_TIMEOUT_MS);

  try {
    // `same-origin` credentials rather than the default `omit` of a bare fetch:
    // the entry this is meant to overwrite was stored by a cookie-bearing
    // navigation, and a credential-less request is a different cache key.
    await fetch(target, { cache: 'reload', credentials: 'same-origin', signal: controller.signal });
  } catch {
    // Offline, aborted, or refused. Reload anyway -- see above.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recovers clients left on a stale build after a deploy.
 *
 * `/_nuxt/**` is hashed and served `immutable`, so a tab holding an older app
 * shell asks for chunk hashes the live build no longer has. Without this the
 * rejection is only reported, never repaired, and every subsequent route change
 * fails the same way for the rest of the visit.
 */
export default defineNuxtPlugin({
  name: 'chunkReload',
  setup(nuxtApp) {
    const router = useRouter();

    // `app:chunkError` fires mid-navigation, so `window.location` still points at
    // the page being left. Reloading that would strand the user on the old route.
    let pendingPath: string | null = null;
    router.beforeEach((to) => {
      pendingPath = to.fullPath;
    });
    router.afterEach(() => {
      pendingPath = null;
    });

    const recover = (error: unknown, source: string) => {
      const target = pendingPath ?? `${window.location.pathname}${window.location.search}`;

      // A reload cannot fetch the missing chunk while the client is offline, and
      // would drop whatever unsaved state the page holds for nothing.
      if (navigator.onLine === false) {
        reportError('app:chunk-error-offline', error, { 'chunk.target': target, 'chunk.source': source });
        return;
      }

      const { action, guard } = decideChunkReload(parseChunkReloadGuard(readStoredGuard()), Date.now());

      // Another chunk from this same page load already triggered the reload that
      // is about to replace this document. Nothing to do and nothing to report:
      // a broken page orphans several chunks at once and they all land here.
      if (action === 'pending') return;

      if (action === 'exhausted') {
        // Past the attempt budget the reload is not fixing anything, so stop and
        // let the error reach the user instead of cycling the tab.
        reportError('app:chunk-error-unrecoverable', error, {
          'chunk.target': target,
          'chunk.source': source,
          'chunk.attempts': String(guard.attempts),
        });
        return;
      }

      // Persisted BEFORE the await below, so the rest of this burst -- which is
      // already queued and will run before any of it resolves -- reads the spent
      // attempt and takes the `pending` branch above.
      persistGuard(JSON.stringify(guard));

      void refreshCachedDocument(target).then(() => {
        // `force` bypasses Nuxt's per-path guard in favour of the cross-path budget
        // above; `persistState` is deliberately off, because the state was produced
        // by the build we are reloading away from.
        reloadNuxtApp({ path: target, force: true, ttl: CHUNK_RELOAD_WINDOW_MS });
      });
    };

    nuxtApp.hook('app:chunkError', ({ error }) => recover(error, 'hook'));

    // THE HOOK ABOVE DOES NOT SEE EVERY ORPHANED CHUNK, which is why this second
    // entry point exists. Nuxt raises `app:chunkError` from Vite's
    // `vite:preloadError`, and Vite only emits that for imports it wrapped in its
    // preload helper. A layout is loaded by a plain `() => import(...)` out of
    // `virtual:nuxt:/app/.nuxt/layouts.mjs`, so a 404 on a layout chunk rejects
    // with nothing listening and the reader stays on a half-rendered page.
    //
    // That gap WAS this error in production: every occurrence arrived through the
    // global handler and none through the hook. Reusing the same budget matters --
    // both paths can fire for one broken build, and they must share one allowance
    // rather than get two each.
    window.addEventListener('unhandledrejection', (event) => {
      if (!isChunkLoadError(event.reason)) return;

      // Claimed, so the global error reporter does not also file it as an
      // unexplained TypeError while the tab is already reloading.
      event.preventDefault();
      recover(event.reason, 'unhandledrejection');
    });
  },
});
