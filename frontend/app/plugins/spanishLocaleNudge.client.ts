import { reportError } from '~/utils/reportError';

/**
 * Offer once per document after mount, not on each layout change. Restore Nuxt context for composables; this
 * does not restore a component instance for `useI18n`. Report and swallow failures so an optional promotion
 * cannot break hydration.
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
