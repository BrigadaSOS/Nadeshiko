import { mdiTranslate } from '@mdi/js';
import { dismissSpanishNudge, isSpanishNudgeDismissed, shouldOfferSpanish } from '~/utils/spanishLocaleNudge';
import { raiseNudgePanel } from './useNudgePanel';

/**
 * Spanish-only copy targets Spanish browsers on English pages without loading the es bundle.
 * The total includes machine translations, so say 'con traducción al español', not 'oficial'.
 */
const COPY = {
  title: 'Nadeshiko también está en español',
  message: 'Más de 1,3 millones de frases de anime con traducción al español, con audio y vídeo.',
  action: 'Cambiar a español',
  dismiss: 'No, gracias',
} as const;

/**
 * Offers the Spanish site to a Spanish speaker reading the English one, once
 * ever. The decision, and why it is made in the browser rather than during SSR,
 * is in `~/utils/spanishLocaleNudge`.
 */
export function useSpanishLocaleNudge() {
  // Use Nuxt's $i18n from app:mounted. useI18n requires a component setup instance, which
  // runWithContext does not restore.
  const { $i18n } = useNuxtApp();
  const { setPreferredLocale } = useLocalePreference();

  function offerSpanishIfWanted() {
    const storage = import.meta.client ? window.localStorage : undefined;

    const offer = shouldOfferSpanish({
      locale: $i18n.locale.value,
      languages: import.meta.client ? navigator.languages : undefined,
      dismissed: isSpanishNudgeDismissed(storage),
    });
    if (!offer) return;

    usePostHog()?.capture('locale_nudge_shown', { from: $i18n.locale.value, to: 'es' });

    raiseNudgePanel({
      iconPath: mdiTranslate,
      title: COPY.title,
      message: COPY.message,
      actionLabel: COPY.action,
      dismissLabel: COPY.dismiss,
      onAction: () => {
        // Recorded on ACCEPT as well as on dismiss: a nudge nobody takes and a
        // nudge nobody sees look identical in the funnel otherwise.
        usePostHog()?.capture('locale_nudge_accepted', { from: $i18n.locale.value, to: 'es' });
        // Both halves, in the order the language selector uses them. The cookie
        // is what makes the choice stick -- it is the single input the root
        // locale redirect reads at the edge (see `server/utils/localeRouting`) --
        // and `setLocale` is what moves this tab now.
        setPreferredLocale('es');
        // Taking the offer is also an answer, so it is never asked again.
        dismissSpanishNudge(storage);
        void $i18n.setLocale('es');
      },
      onDismiss: () => {
        usePostHog()?.capture('locale_nudge_dismissed', { from: $i18n.locale.value, to: 'es' });
        dismissSpanishNudge(storage);
      },
    });
  }

  return { offerSpanishIfWanted };
}
