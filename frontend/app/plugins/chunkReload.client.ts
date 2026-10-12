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
    // Blocked storage removes persistent loop protection; treat the guard as empty and still attempt
    // recovery.
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
 * Replace the browser's cached document before navigation, which may otherwise reuse the stale shell. `cache:
 * 'reload'` bypasses and updates that entry; fetch failure still proceeds to reload.
 */
async function refreshCachedDocument(target: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOCUMENT_REFRESH_TIMEOUT_MS);

  try {
    // Preserve navigation credentials while refreshing the cached document.
    await fetch(target, { cache: 'reload', credentials: 'same-origin', signal: controller.signal });
  } catch {
    // Offline, aborted, or refused. Reload anyway -- see above.
  } finally {
    clearTimeout(timer);
  }
}

/** Recover stale shells requesting hashed chunks removed by a deploy. */
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

      // Persist before awaiting so other failures in this burst see a pending reload.
      persistGuard(JSON.stringify(guard));

      void refreshCachedDocument(target).then(() => {
        // `force` bypasses Nuxt's per-path guard in favour of the cross-path budget
        // above; `persistState` is deliberately off, because the state was produced
        // by the build we are reloading away from.
        reloadNuxtApp({ path: target, force: true, ttl: CHUNK_RELOAD_WINDOW_MS });
      });
    };

    nuxtApp.hook('app:chunkError', ({ error }) => recover(error, 'hook'));

    // Plain layout imports can reject outside Vite's preload helper and Nuxt's hook. Catch them globally
    // using the same budget so one broken build cannot receive two recovery allowances.
    window.addEventListener('unhandledrejection', (event) => {
      if (!isChunkLoadError(event.reason)) return;

      // Claimed, so the global error reporter does not also file it as an
      // unexplained TypeError while the tab is already reloading.
      event.preventDefault();
      recover(event.reason, 'unhandledrejection');
    });
  },
});
