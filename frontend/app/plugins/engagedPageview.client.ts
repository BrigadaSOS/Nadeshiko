import { posthog, isAnalyticsEnabled } from '~/utils/posthogClient';
import { ENGAGED_VIEW_DWELL_MS, createEngagedViewGate, type EngagedViewGate } from '~/utils/engagedView';

/**
 * Emit one foreground-dwell engagement event per page, independently of raw `$pageview`. Their gap helps
 * measure fetch-only traffic without changing the existing view series. Keep the narrower `shared_link_read`
 * event unchanged.
 */
export default defineNuxtPlugin({
  name: 'engagedPageview',
  // PostHog must declare analytics startup before this plugin checks the gate.
  dependsOn: ['posthog'],
  setup() {
    // Gate on analytics startup, not SDK readiness; captures can queue during loading.
    if (!isAnalyticsEnabled()) return;

    const router = useRouter();

    let gate: EngagedViewGate | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPath: string | null = null;

    const clear = (): void => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };

    const fire = (): void => {
      timer = null;
      // `claim` is the authority, not the timer: it re-checks accumulated
      // foreground time and answers at most once per page, so a timer that runs
      // long (background throttling) or twice cannot over-report.
      if (!gate?.claim(Date.now())) return;
      // posthog-js stamps `$current_url` / `$pathname` / `$referrer` onto every
      // capture, so the page this refers to needs no properties of our own.
      posthog.capture('page_engaged');
    };

    /** Schedules the claim for whatever dwell is still owed. Foreground only. */
    const arm = (): void => {
      clear();
      if (gate === null) return;

      const remaining = ENGAGED_VIEW_DWELL_MS - gate.elapsed(Date.now());
      if (remaining <= 0) {
        fire();
        return;
      }

      timer = setTimeout(fire, remaining);
    };

    /**
     * Reset by path only: query-string/filter changes and hydration's initial afterEach must not restart
     * dwell on the same path. A new search word changes the path and starts a new dwell.
     */
    const begin = (path: string): void => {
      if (path === lastPath) return;
      lastPath = path;

      clear();
      const visible = document.visibilityState === 'visible';
      gate = createEngagedViewGate(ENGAGED_VIEW_DWELL_MS, visible, Date.now());
      // A page opened into a background tab schedules nothing until it is
      // brought forward, so it is counted when it is read and never before.
      if (visible) arm();
    };

    // Not `useEventListener`: a plugin has no effect scope to dispose into, and
    // this listener is meant to live as long as the document does.
    document.addEventListener('visibilitychange', () => {
      const visible = document.visibilityState === 'visible';
      gate?.setVisible(visible, Date.now());
      if (visible) arm();
      else clear();
    });

    begin(router.currentRoute.value.path);
    router.afterEach((to) => begin(to.path));
  },
});
