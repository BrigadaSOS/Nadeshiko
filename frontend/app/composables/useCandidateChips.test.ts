import { describe, test, expect } from 'vitest';
import { ref } from 'vue';
import { useCandidateChips } from './useCandidateChips';
import { glossPreference, type ShirabeCandidate } from '~/utils/wordCard';

/**
 * The candidate row: which chips are drawn, and which of them need a letter of
 * part-of-speech to be told apart.
 *
 * `duplicateHeadwords` is the decision worth pinning, and the component's own
 * test says out loud that it cannot reach it: exercising the part-of-speech
 * INITIAL there needs a fixture reproducing Shirabe's tag shape faithfully
 * enough to be testing the fixture. Here the input is the argument, so it can be.
 *
 * Getting it backwards fails in one of two ways, both bad: label everything and
 * every card carries noise for the sake of the rare ambiguous one; label nothing
 * and あれ shows twice with nothing to choose by.
 */
const preference = glossPreference('en', { en: 'show', es: 'show' });

function candidate(headword: string, reading = '', partOfSpeech?: string): ShirabeCandidate {
  return {
    headword,
    reading,
    senses: partOfSpeech ? [{ partOfSpeech: [partOfSpeech], glosses: [{ language: 'en', text: 'x' }] }] : [],
  } as unknown as ShirabeCandidate;
}

const chips = (list: ShirabeCandidate[], picked = 0) =>
  useCandidateChips(
    () => list,
    () => picked,
    () => preference,
  );

describe('whether the row is offered at all', () => {
  test('one candidate is not a choice', () => {
    expect(chips([candidate('猫')]).showCandidateRows.value).toBe(false);
  });

  test('two are', () => {
    expect(chips([candidate('有れ'), candidate('我')]).showCandidateRows.value).toBe(true);
  });
});

describe('telling two chips apart', () => {
  test('spellings printed differently need no part of speech', () => {
    // Counted over what is PRINTED: 有れ and 我 are already distinct.
    const { duplicateHeadwords } = chips([candidate('有れ'), candidate('我')]);

    expect(duplicateHeadwords.value.size).toBe(0);
  });

  test('two candidates printed the same are marked as duplicates', () => {
    const { duplicateHeadwords } = chips([candidate('あれ'), candidate('あれ')]);

    expect([...duplicateHeadwords.value]).toEqual(['あれ']);
  });

  test('only the colliding label is marked, not the whole row', () => {
    const { duplicateHeadwords } = chips([candidate('あれ'), candidate('あれ'), candidate('我')]);

    expect([...duplicateHeadwords.value]).toEqual(['あれ']);
  });
});

describe('how many chips are drawn', () => {
  const many = () => Array.from({ length: 7 }, (_, i) => candidate(`語${i}`));

  test('the row stops at four, so it holds one line', () => {
    expect(chips(many()).visibleCandidates.value).toHaveLength(4);
  });

  test('the rest are counted, so the list can offer them', () => {
    expect(chips(many()).hiddenCandidateCount.value).toBe(3);
  });

  test('a row that fits hides nothing', () => {
    expect(chips([candidate('有れ'), candidate('我')]).hiddenCandidateCount.value).toBe(0);
  });

  test('the picked candidate keeps a chip even when it sits past the cut', () => {
    // `pickerChips` guarantees it: collapsing the list back to the row must not
    // take the reader's own pick off screen.
    const { visibleCandidates } = chips(many(), 6);

    expect(visibleCandidates.value.map((chip) => chip.index)).toContain(6);
  });

  test('a chip carries its index in the FULL list, not in the row', () => {
    // Picking by row position would switch the card to the wrong word: the chip
    // for 語6 sits fourth in the row and must still say 6.
    const list = many();
    const { visibleCandidates } = chips(list, 6);

    for (const chip of visibleCandidates.value) {
      expect(chip.candidate).toBe(list[chip.index]);
    }
  });
});

describe('reacting to the pick moving', () => {
  test('the row follows a pick made after it was drawn', () => {
    const picked = ref(0);
    const list = Array.from({ length: 7 }, (_, i) => candidate(`語${i}`));
    const { visibleCandidates } = useCandidateChips(
      () => list,
      () => picked.value,
      () => preference,
    );

    expect(visibleCandidates.value.map((c) => c.index)).not.toContain(6);
    picked.value = 6;
    expect(visibleCandidates.value.map((c) => c.index)).toContain(6);
  });
});
