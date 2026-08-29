import { computed } from 'vue';
import {
  cardForms,
  cardSenses,
  headwordFurigana,
  kanjiIn,
  pitchMorae,
  shirabeKanjiUrl,
  type GlossLanguage,
  type GlossPreference,
} from '~/utils/wordCard';
import type { EnrichedToken } from '~/utils/tokenEnrichment';

// The one word on this card that is prose rather than data, and it is keyed by
// GLOSS language rather than by UI locale, so it cannot come from i18n: `t()`
// answers in the interface language, while this badge sits among definitions the
// reader chose to read in English or Spanish. Reading Nadeshiko in Japanese with
// Spanish glosses on, "常用" over "Frecuente" would be the odd one out.
const COMMON_LABEL: Record<GlossLanguage, string> = { en: 'Common', es: 'Frecuente' };

/**
 * Everything the word card PRINTS, derived from the word it is showing.
 *
 * Pure: no state, no requests, no side effects -- each value is a function of
 * the picked word, the token the card opened on, and the reader's gloss
 * preference. That is what makes the card's rendering decisions testable without
 * mounting it, and it is why the lookup that produces `word` lives elsewhere.
 */
export function useWordCardContent(
  word: () => ShirabeWord | null,
  token: () => EnrichedToken | null,
  headword: () => string,
  glossLanguages: () => GlossPreference,
  hiddenDefinitionLanguages: () => readonly GlossLanguage[],
  shirabeLinked: () => boolean,
) {
  // 1. Head. The reading is the dictionary's, not the surface's: 焼けた reads
  // やけた, but the word above the senses is 焼ける, and printing it over the
  // inflected reading would be a lie.
  const headReading = computed(() => {
    const reading = word()?.reading || token()?.readingHiragana || '';
    // For この the reading IS この, so a second copy of it adds nothing.
    if (reading === headword()) return '';
    return reading;
  });

  /**
   * Ruby for the headword: Shirabe's alignment once the card has it, and the
   * token's own until then.
   *
   * Falling back matters for more than completeness. With only Shirabe's, the head
   * had NO furigana while the lookup was in flight, so the reading rendered as a
   * separate label beside the word -- and then jumped to ruby above it the moment
   * the answer arrived. The card visibly rebuilt itself mid-read. The token was
   * carrying furigana the whole time; using it keeps the head one shape from the
   * first frame, and Shirabe's replaces it invisibly because it is the same
   * alignment of the same word.
   */
  const headFurigana = computed(() => {
    // Guarded: Shirabe's per-candidate furigana does not always spell that
    // candidate's headword. See `headwordFurigana`.
    const fromWord = headwordFurigana(word());
    if (fromWord.length > 0) return fromWord;

    // Only when the head IS the token's own surface. An inflected token shows its
    // dictionary form up here (食べている → 食べる), and the surface's ruby does not
    // align with a word it does not spell.
    const current = token();
    if (!current || current.displaySurface !== headword()) return [];
    return current.furigana.filter((seg) => seg.text).map((seg) => ({ text: seg.text, reading: seg.reading ?? '' }));
  });

  // 2. What this occurrence does to the dictionary form, outermost step first:
  // 食べさせられた is "past · potential / passive · causative" rather than one name
  // that would be true of only its last step.
  const inflectionLine = computed(() => {
    const current = token();
    if (!current || current.inflectionLabels.length === 0) return '';
    // The chain alone -- "progressive · te-form" -- and not "食らって → 食らう ·
    // te-form". Both ends of that arrow are already on screen: the surface is the
    // word the reader just pointed at in the sentence, and the dictionary form is
    // the headword directly above this line. Spelling the conversion out again
    // pushed the one thing this line is FOR to the far right of it.
    //
    // The labels are Shirabe's own, verbatim from the parse, so a form reads the
    // same here as it does there: its wording carries the detail a bare name
    // would lose ("potential / passive", "provisional (〜ば)").
    return current.inflectionLabels.join(' · ');
  });

  // 3. Badges: how common the word is, in the three ways the dictionary knows.
  const badges = computed(() => {
    const found = word();
    if (!found) return [];
    const items: Array<{ id: string; text: string; kind: string }> = [];
    if (found.common) items.push({ id: 'common', text: COMMON_LABEL[glossLanguages().labels], kind: 'is-common' });
    if (found.jlpt) items.push({ id: 'jlpt', text: found.jlpt, kind: 'is-jlpt' });
    if (typeof found.frequency === 'number') items.push({ id: 'freq', text: `#${found.frequency}`, kind: 'is-freq' });
    return items;
  });

  /**
   * 4. Pitch accent. Two patterns at most: a word read four ways is rare enough
   * that it must not push the senses out of a hover card.
   *
   * Each pattern carries its own clip, which Shirabe pre-generates per (reading,
   * accent) and serves off its public CDN -- there is nothing to request, nothing
   * to authorize, and no work for our own API to do. The clip is per pattern and
   * not per word on purpose: a word read two ways is two recordings, and one
   * button in front of both would play whichever happened to exist while pointing
   * at an accent it might not be. Coverage lights up batch by batch, so a pattern
   * with no recording simply has no button -- a dead speaker icon invites a click
   * that does nothing.
   */
  const pitchPatterns = computed(() => {
    const reading = word()?.reading;
    if (!reading) return [];
    return (word()?.pitch ?? []).slice(0, 2).map((pattern) => ({
      downstep: pattern.downstep,
      audioUrl: pattern.audioUrl ?? '',
      morae: pitchMorae(reading, pattern.downstep),
    }));
  });

  // 5 and 6. The senses, and the kanji the headword is written with.
  const senses = computed(() => cardSenses(word(), glossLanguages()));

  /** How many dictionaries this card is made of. One for every reader who has not
   *  linked a Shirabe account, which is what decides whether the senses are worth
   *  attributing at all. */
  const sourceCount = computed(() => new Set(senses.value.map((sense) => sense.dictionary)).size);

  /**
   * Whether to name the dictionary above its senses.
   *
   * More than one on the card, obviously. But also whenever the reader has LINKED
   * an account, even for a single dictionary, and that second case is the useful
   * one: their stack does not have every word in it, so a word none of their
   * dictionaries carries falls back to the one that resolved it -- and unlabelled,
   * that card is an English definition appearing among Japanese ones for no
   * visible reason. Naming it answers the question before it is asked.
   *
   * A reader who linked nothing always reads one dictionary, so a label on every
   * card would be noise charged to everybody for a case they cannot be in.
   */
  const namesSources = computed(() => sourceCount.value > 1 || shirabeLinked());

  /**
   * The words this one is made of, when it is a merged expression.
   *
   * The row exists because a merge DELETES what it spans. 男を知っている is one
   * chip covering 男 (rank 156) and 知る (69), and the expression is the only
   * candidate the resolver returns -- so without this there is no way to reach
   * either word: not by hovering, since the chip covers them, and not through the
   * picker, since there is nothing else in it.
   *
   * Only the ones Shirabe could resolve to a word. A part with no id is a spelling
   * we cannot open, and a chip that does nothing when clicked is worse than no
   * chip.
   */
  const wordParts = computed(() => (word()?.parts ?? []).filter((part) => part.id));

  /** The other spellings this word is written with. Only from the detail call:
   *  identify carries them behind `include=forms`, which we do not send yet. */
  const forms = computed(() => cardForms(word()));

  /** An entry that exists but says nothing the reader can read, because they
   *  turned that language off. The card offers to show it anyway rather than
   *  looking empty for no visible reason. */
  const definitionsAreHidden = computed(
    () => word() !== null && senses.value.length === 0 && hiddenDefinitionLanguages().length > 0,
  );

  const kanjiChips = computed(() =>
    kanjiIn(headword()).map((character) => ({
      character,
      href: shirabeKanjiUrl(character, glossLanguages().labels),
    })),
  );

  return {
    headReading,
    headFurigana,
    inflectionLine,
    badges,
    pitchPatterns,
    senses,
    sourceCount,
    namesSources,
    wordParts,
    forms,
    definitionsAreHidden,
    kanjiChips,
  };
}
