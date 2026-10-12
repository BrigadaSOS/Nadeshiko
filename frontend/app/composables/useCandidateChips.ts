import { computed } from 'vue';
import {
  candidateName,
  candidatePartOfSpeech,
  pickerChips,
  type GlossPreference,
  type ShirabeCandidate,
} from '~/utils/wordCard';

/** Keep the glance to one readable line; overflow candidates remain available in the list. */
const PICKER_VISIBLE = 4;

/**
 * Use Shirabe's name flag, not dictionary slug: JMdict also carries name entries. Name-only
 * answers retain their tags.
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
   * Use the localized part-of-speech initial to disambiguate compact chips; title carries the
   * full label and the expanded list supplies glosses.
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
