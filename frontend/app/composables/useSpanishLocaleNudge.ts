import { mdiTranslate } from '@mdi/js';
import { dismissSpanishNudge, isSpanishNudgeDismissed, shouldOfferSpanish } from '~/utils/spanishLocaleNudge';
import { raiseNudgePanel } from './useNudgePanel';

/**
 * The copy is Spanish and is NOT translated, which is the one thing about this
 * file that looks like a mistake and is not.
 *
 * It is addressed only to readers whose browser asks for Spanish, and it appears
 * only on an English page -- so an English string would be talking past the
 * person it is for, and a `ja` string could never be reached at all. Putting it
 * through `$t` would also mean loading the `es` message bundle on an English
 * page, which is exactly the ~48KB that `file:` per-locale loading was added to
 * avoid.
 *
 * "1,3 millones" is the TOTAL sentence count (1,326,042 on 2026-08-23), and the
 * line deliberately says "con traducción al español" rather than "oficial":
 * every one of those has a Spanish translation, but 116,015 of them are machine
 * translated and only 1,210,027 are official. Say "oficial" here and the honest
 * number is 1,2 millones.
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
  const { locale, setLocale } = useI18n();
  const { setPreferredLocale } = useLocalePreference();

  function offerSpanishIfWanted() {
    const storage = import.meta.client ? window.localStorage : undefined;

    const offer = shouldOfferSpanish({
      locale: locale.value,
      languages: import.meta.client ? navigator.languages : undefined,
      dismissed: isSpanishNudgeDismissed(storage),
    });
    if (!offer) return;

    usePostHog()?.capture('locale_nudge_shown', { from: locale.value, to: 'es' });

    raiseNudgePanel({
      iconPath: mdiTranslate,
      title: COPY.title,
      message: COPY.message,
      actionLabel: COPY.action,
      dismissLabel: COPY.dismiss,
      onAction: () => {
        // Recorded on ACCEPT as well as on dismiss: a nudge nobody takes and a
        // nudge nobody sees look identical in the funnel otherwise.
        usePostHog()?.capture('locale_nudge_accepted', { from: locale.value, to: 'es' });
        // Both halves, in the order the language selector uses them. The cookie
        // is what makes the choice stick -- it is the single input the root
        // locale redirect reads at the edge (see `server/utils/localeRouting`) --
        // and `setLocale` is what moves this tab now.
        setPreferredLocale('es');
        // Taking the offer is also an answer, so it is never asked again.
        dismissSpanishNudge(storage);
        void setLocale('es');
      },
      onDismiss: () => {
        usePostHog()?.capture('locale_nudge_dismissed', { from: locale.value, to: 'es' });
        dismissSpanishNudge(storage);
      },
    });
  }

  return { offerSpanishIfWanted };
}
