import type { TranslationVisibilityMode } from '~/composables/useTranslationVisibility';

import type { IdentifiedCandidate } from '@shirabe-org/card/word-card/api-host';
import type { ApiSense } from '@shirabe-org/card/word-card/api-types';

export type ShirabeText = ApiSense['definitions'][number];
export type ShirabeCandidate = IdentifiedCandidate;

/**
 * The languages a definition can be shown in here.
 *
 * JMdict ships more than these (French, German, Russian, Dutch), and Shirabe
 * returns every one an entry has. Nadeshiko has a reader preference for exactly
 * two, though, and a French gloss handed to a reader who asked for neither is
 * noise, so anything outside this list is dropped rather than guessed at.
 */
export type GlossLanguage = 'en' | 'es';

const GLOSS_LANGUAGES: readonly GlossLanguage[] = ['en', 'es'];

/**
 * What the card can PRINT, which is wider than what the reader has a preference
 * about.
 *
 * `GlossLanguage` is the pair the translation-visibility setting is written in
 * terms of, and it is about JMdict's translations. Japanese is not one of those:
 * it arrives from a monolingual dictionary that only appears here because the
 * reader put it in their own Shirabe stack, which is a stronger statement than
 * any toggle on this site. So it can be printed without being something to hide
 * or reorder.
 */
export type PrintLanguage = GlossLanguage | 'ja';

export interface GlossPreference {
  /** Definition languages the reader has not hidden, their own language first.
   *  Empty when they have hidden every one. */
  order: GlossLanguage[];
  /** Globally enabled languages that a local search visibility choice hid.
   *  They are a last-resort dictionary fallback; globally excluded languages
   *  never return through this door. */
  fallback: GlossLanguage[];
  /** The one language Shirabe resolves part-of-speech and misc labels into
   *  (`?locale=`). Never empty: a card whose labels are in nobody's language
   *  helps nobody, so this falls back to the reader's own. */
  labels: GlossLanguage;
}

/**
 * What the reader reads, which is not what the interface is in.
 *
 * The UI language and the translation language are separate settings: someone
 * reads the site in English and studies from Spanish glosses, or the other way
 * round. The interface language only decides the ORDER here (your own language
 * first); the visibility preference decides who is on the list at all.
 *
 * 'spoiler' counts as shown. It means "make me try first" on a translation
 * sitting next to the Japanese, and a tooltip is something the reader opened on
 * purpose: they have already decided to look.
 */
export function glossPreference(
  uiLocale: string,
  modes: Record<GlossLanguage, TranslationVisibilityMode>,
  languageOrder: readonly GlossLanguage[] = homeFirst(uiLocale === 'es' ? 'es' : 'en'),
): GlossPreference {
  // Spanish for a Spanish reader; English for everyone else, including the
  // Japanese interface, because English is the language JMdict is written in
  // and the one every entry is most likely to have.
  const home: GlossLanguage = uiLocale === 'es' ? 'es' : 'en';
  // The saved global choice decides which dictionary languages matter and in
  // what order. The search control can still hide one on that surface.
  const enabled = languageOrder.filter((lang): lang is GlossLanguage => GLOSS_LANGUAGES.includes(lang));
  const order = enabled.filter((lang) => modes[lang] !== 'hidden');
  return {
    order,
    fallback: enabled.filter((lang) => !order.includes(lang)),
    labels: order[0] ?? home,
  };
}

function homeFirst(home: GlossLanguage): GlossLanguage[] {
  return [home, ...GLOSS_LANGUAGES.filter((lang) => lang !== home)];
}

/**
 * The definitions to print, filtered and ordered by what the reader reads.
 *
 * Shirabe returns every language the entry has, each tagged, and deliberately
 * does not choose. Choosing here rather than in the request is what lets ONE
 * cached response serve a reader with both languages on and a reader with one
 * off, and it is why the request is only keyed by the label language.
 *
 * A search-local hide does not make a language globally irrelevant. A reader
 * who reads only Spanish on that surface still meets words JMdict has no
 * Spanish gloss for, so it may fall back to another globally enabled language.
 *
 * A globally excluded language is never used as a fallback: that choice means
 * the reader does not care about it anywhere. When every globally enabled
 * language is hidden, the card gets no definitions at all.
 */
export function selectDefinitions(definitions: ShirabeText[] | undefined, preference: GlossPreference): ShirabeText[] {
  const wanted = preference.order.length > 0 ? inLanguages(definitions, preference.order) : [];
  if (wanted.length > 0) return wanted;

  const fallback = preference.order.length > 0 ? inLanguages(definitions, preference.fallback) : [];
  if (fallback.length > 0) return fallback;

  // A sense with nothing in either preference language, which since readers can
  // link a Shirabe account is no longer the same as a sense with nothing worth
  // printing. A monolingual dictionary writes in Japanese, and a reader only
  // ever meets one here by putting it in their own dictionary stack -- so it is
  // shown because they asked for it, not governed by a visibility preference
  // that was written when JMdict's translations were the only thing on the card.
  //
  // Still not "print whatever arrived": JMdict also ships French, German, Dutch
  // and Russian, and none of those is a language anybody here chose.
  return inLanguages(definitions, ['ja']);
}

/** Definitions in the given languages, that order, keeping each language's own
 *  order within itself. Anything in a language not asked for is left out. */
function inLanguages(definitions: ShirabeText[] | undefined, langs: readonly PrintLanguage[]): ShirabeText[] {
  const source = definitions ?? [];
  return langs.flatMap((lang) => source.filter((definition) => definition.lang?.toLowerCase() === lang));
}
