import { computed } from 'vue';
import {
  candidateName,
  candidatePartOfSpeech,
  pickerChips,
  type GlossPreference,
  type ShirabeCandidate,
} from '~/utils/wordCard';

/**
 * How many chips the glance shows before it stops.
 *
 * Four, not six. The row is no longer the only way to reach a candidate -- what
 * it does not fit opens as a list a click away -- so it can be sized for what is
 * READABLE at the card's width rather than for what is reachable. Four chips
 * hold one line at the widths these words run to; six wrapped, and a wrapped
 * glance is not one.
 */
const PICKER_VISIBLE = 4;

/**
 * Whether a candidate is a person or a place rather than a word.
 *
 * Read off the flag Shirabe publishes, never off the dictionary slug: JMdict
 * carries ~7,300 JMnedict rows under its own name, so a slug test keeps every
 * one of them and never says so. あれ is the case that shows it -- 亜礼, 阿礼 and
 * 安礼 all arrive under `jmdict`.
 *
 * Names are normally filtered out of an answer entirely (see
 * `withoutNameEntries`), so this only has anything to mark in the one case where
 * they survive: a token that resolves to nothing BUT names. Then the tag is what
 * stops six unfamiliar spellings reading as six words the reader has never met.
 */
const isNameCandidate = (candidate: ShirabeCandidate): boolean => candidate.name === true;

/**
 * The candidate row, derived: which chips to draw, which need a part of speech
 * to tell them apart, and how many did not fit.
 *
 * Pure -- every value here is a function of the candidates, the pick and the
 * gloss preference, with no state of its own -- which is what makes it testable
 * away from the card.
 */
export function useCandidateChips(
  candidates: () => readonly ShirabeCandidate[],
  picked: () => number,
  glossLanguages: () => GlossPreference,
) {
  /**
   * Whether there is anything to offer at all.
   *
   * One candidate is not a choice, and a row of one is a control that asks the
   * reader to consider something already settled.
   */
  const showCandidateRows = computed(() => candidates().length > 1);

  /**
   * The one letter that tells two same-spelling candidates apart, with the whole
   * word on hover.
   *
   * PRONOUN and INTERJECTION spelled out cost more row than the words they were
   * disambiguating -- あれ PRONOUN / あれ INTERJECTION pushed 有れ and 我 to the
   * edge, so a tiebreak between two chips was crowding out the other four. An
   * initial is enough to tell them apart, which is the whole job; `title` carries
   * the rest for anyone who wants it, the same way the sense chips do.
   *
   * A collision (two candidates whose labels share a letter) is not worth guarding
   * against: if two spellings have the SAME part of speech then the full word
   * would not separate them either, and the list below -- where every row carries
   * its gloss -- is what answers that.
   *
   * Localized by construction: it is the first character of the label the card
   * would print, so Spanish gets P/I too and Japanese gets 代/感.
   */
  function posInitial(candidate: ShirabeCandidate): string {
    return [...candidatePartOfSpeech(candidate, glossLanguages())][0] ?? '';
  }

  /**
   * The spellings more than one candidate answers to.
   *
   * Only these get a part of speech on their chip. あれ is two words -- the
   * pronoun and the interjection -- and without it the row shows あれ twice with
   * nothing to choose by; every other chip is already distinct, and a label on all
   * of them would be noise charged to the many for the sake of the few.
   */
  const duplicateHeadwords = computed(() => {
    const counts = new Map<string, number>();
    // Counted over what is PRINTED (`candidateName`), not over the headword: two
    // chips are indistinguishable to a reader when they carry the same label, and
    // a word shown under its kanji is no longer a duplicate of the kana it shares
    // a headword with.
    for (const candidate of candidates()) {
      const name = candidateName(candidate);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
  });

  /** The chips to draw. The decision, and why the index travels with the
   *  candidate, is `pickerChips`. */
  const visibleCandidates = computed(() => pickerChips([...candidates()], picked(), false, PICKER_VISIBLE));

  const hiddenCandidateCount = computed(() => Math.max(0, candidates().length - PICKER_VISIBLE));

  // `isNameCandidate` is returned rather than exported so it reaches the card's
  // TEMPLATE as a setup binding; a bare module export would only be in scope
  // for the script.
  return {
    showCandidateRows,
    posInitial,
    duplicateHeadwords,
    visibleCandidates,
    hiddenCandidateCount,
    isNameCandidate,
  };
}
