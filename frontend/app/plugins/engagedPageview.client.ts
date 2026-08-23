import { posthog, isAnalyticsEnabled } from '~/utils/posthogClient';
import { ENGAGED_VIEW_DWELL_MS, createEngagedViewGate, type EngagedViewGate } from '~/utils/engagedView';

/**
 * Fires `page_engaged` once a page has held someone's attention, for every page
 * rather than just permalinks.
 *
 * `pages/sentence/[id].vue` already draws this distinction for `/sentence/:id`,
 * and the scraper population it was built against turned out not to be confined
 * there. On 2026-08-19 the homepage took 686 full renders from three Azure
 * addresses running headless Chrome, which PostHog counted as ~800 separate
 * people: each render is a fresh browser profile, so each gets its own anonymous
 * device id. `$pageview` for the day read 2,959 against a ~700 baseline and
 * unique users 1,759 against ~250, none of it flagged -- `isLikelyBot` sees a
 * valid Chrome user-agent string and passes it through, and the classification
 * PostHog does expose (`$virt_is_bot`, `$virt_traffic_type`) put all 30 days of
 * traffic in `Regular` bar sixteen pageviews.
 *
 * So the same test is applied site-wide, for the same reason it was chosen
 * there: a scraper is gone within a load, and dwell is the one signal that
 * separates the two populations without an allow-list anyone has to maintain.
 * User-agent tests do not, and neither do the fingerprint heuristics -- the
 * numbers behind both are in `~/utils/engagedView`.
 *
 * ADDITIVE, like the permalink pair. `$pageview` still fires on every load and
 * keeps its meaning, so nothing about the existing series changes and no
 * comparison across this deploy shows a step that is really an instrumentation
 * change. Automated traffic also stays countable: the gap between `$pageview`
 * and `page_engaged` *is* the scraping metric, and dropping at capture would
 * throw away the only number that shows the problem exists. It leaves the
 * threshold re-cuttable at query time too, which matters more here than on
 * permalinks -- 2,500ms was reasoned against readers landing on a sentence, and
 * whether it suits `/media` or `/stats` is a question the data can now answer.
 *
 * `shared_link_read` stays exactly as it is. It carries `segment_id` and
 * `media_name` and answers a narrower question than this does, and retiring it
 * in favour of this event would break the series it exists to provide.
 */
export default defineNuxtPlugin({
  name: 'engagedPageview',
  // The `posthog` plugin is what starts the SDK loading, and `isAnalyticsEnabled()`
  // below is false until it has. Without this that test would run first and this
  // plugin would never install itself in production -- alphabetical order puts
  // `engagedPageview` well ahead of `posthog`.
  dependsOn: ['posthog'],
  setup() {
    // Not `posthog.__loaded`: the SDK is fetched asynchronously now, so at plugin
    // time it has certainly not arrived and that test would be false on every
    // load. What this actually wants to know is whether analytics exist on this
    // build at all -- they do not outside production, where the module is not
    // installed. Everything captured before the SDK lands is queued, so the gate
    // is "will there be a client" and not "is there one yet".
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
     * Starts a fresh gate for a page.
     *
     * Keyed on path, so the query-string churn of a search does not restart the
     * clock on a reader who is sitting on one set of results -- and so the
     * `afterEach` that fires on hydration, for the route this already started,
     * is a no-op rather than a rewind.
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
