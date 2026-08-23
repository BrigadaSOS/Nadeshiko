import { reportError } from '~/utils/reportError';

/**
 * Raises the Spanish offer once per page load, after the app is mounted.
 *
 * `app:mounted` rather than a layout's `onMounted`: the decision needs
 * `navigator.languages` and `localStorage`, so it cannot run during SSR, and
 * hanging it off a layout would fire it again on every layout swap. Client
 * plugin, so it is never bundled into the server build at all.
 *
 * Once per LOAD, not once per route change -- a reader who navigates ten times
 * without answering is asked once, and the panel has no timeout so it is still
 * there when they get to it. Once they answer, `localStorage` ends it for good.
 *
 * `runWithContext` because the composables inside want a Nuxt app: `useI18n`
 * and `useCookie` both resolve through the instance, and an `app:mounted`
 * callback is not inside a component `setup()`. Without it they throw, and the
 * throw lands during hydration.
 *
 * And the whole thing is wrapped, which is the point worth keeping. This is a
 * promotion. There is no version of "we could not offer the Spanish site" that
 * justifies taking the page down with it, so a failure here is reported and
 * swallowed rather than allowed to reach the error boundary.
 */
export default defineNuxtPlugin({
  name: 'spanish-locale-nudge',
  setup(nuxtApp) {
    nuxtApp.hook('app:mounted', () => {
      try {
        nuxtApp.runWithContext(() => useSpanishLocaleNudge().offerSpanishIfWanted());
      } catch (error) {
        reportError('locale-nudge:failed', error);
      }
    });
  },
});
