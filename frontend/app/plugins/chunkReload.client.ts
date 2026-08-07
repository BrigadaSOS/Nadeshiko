import {
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  decideChunkReload,
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

    nuxtApp.hook('app:chunkError', ({ error }) => {
      const target = pendingPath ?? `${window.location.pathname}${window.location.search}`;

      // A reload cannot fetch the missing chunk while the client is offline, and
      // would drop whatever unsaved state the page holds for nothing.
      if (navigator.onLine === false) {
        reportError('app:chunk-error-offline', error, { 'chunk.target': target });
        return;
      }

      const { reload, guard } = decideChunkReload(parseChunkReloadGuard(readStoredGuard()), Date.now());

      if (!reload) {
        // Past the attempt budget the reload is not fixing anything, so stop and
        // let the error reach the user instead of cycling the tab.
        reportError('app:chunk-error-unrecoverable', error, {
          'chunk.target': target,
          'chunk.attempts': String(guard.attempts),
        });
        return;
      }

      persistGuard(JSON.stringify(guard));

      // `force` bypasses Nuxt's per-path guard in favour of the cross-path budget
      // above; `persistState` is deliberately off, because the state was produced
      // by the build we are reloading away from.
      reloadNuxtApp({ path: target, force: true, ttl: CHUNK_RELOAD_WINDOW_MS });
    });
  },
});
