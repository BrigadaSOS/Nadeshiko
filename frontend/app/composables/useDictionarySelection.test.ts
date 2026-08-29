import { describe, test, expect } from 'vitest';
import { ref } from 'vue';
import { useDictionarySelection } from './useDictionarySelection';
import type { CardSense } from '~/utils/wordCard';

/**
 * Which dictionaries a mine carries.
 *
 * The decision worth pinning is `pickedForExport`: an empty pick and a FULL pick
 * mean the same thing -- export everything -- because the reader is building a
 * shortlist by leaving things out, not by adding things in. Get that backwards
 * and "Select all" silently becomes a filter that trims nothing, or worse, an
 * empty card exports an empty definition.
 *
 * The other is deduplication by KEY rather than by name. Two of a reader's own
 * uploads can share a title, and fusing them into one toggle would hand somebody
 * who ticked one the senses of both.
 */
function sense(dictionary: string, dictionarySlug = ''): CardSense {
  return { dictionary, dictionarySlug } as CardSense;
}

const summarise = (picked: number, total: number) => `${picked}/${total}`;

describe('the dictionaries on the card', () => {
  test('are listed once each, in the order they are printed', () => {
    const { cardDictionaries } = useDictionarySelection(
      () => [sense('JMdict'), sense('Daijirin'), sense('JMdict')],
      () => true,
      summarise,
    );

    expect(cardDictionaries.value.map((d) => d.name)).toEqual(['JMdict', 'Daijirin']);
  });

  test('two uploads sharing a title stay two toggles, because the key differs', () => {
    const { cardDictionaries } = useDictionarySelection(
      () => [sense('My Deck', 'deck-a'), sense('My Deck', 'deck-b')],
      () => true,
      summarise,
    );

    expect(cardDictionaries.value).toHaveLength(2);
  });
});

describe('what a pick exports', () => {
  const senses = [sense('JMdict', 'jmdict'), sense('Daijirin', 'daijirin')];

  test('nothing ticked means everything, not nothing', () => {
    const { pickedForExport } = useDictionarySelection(
      () => senses,
      () => true,
      summarise,
    );

    expect(pickedForExport.value.size).toBe(0);
  });

  test('every dictionary ticked means the same as none ticked', () => {
    const { selectAllDictionaries, pickedForExport, pickedDictionaries } = useDictionarySelection(
      () => senses,
      () => true,
      summarise,
    );

    selectAllDictionaries();

    // The reader HAS ticked both -- the row shows that -- but the instruction
    // carried to the note is still "everything".
    expect(pickedDictionaries.value.size).toBe(2);
    expect(pickedForExport.value.size).toBe(0);
  });

  test('a genuine subset is carried through', () => {
    const { togglePick, pickedForExport } = useDictionarySelection(
      () => senses,
      () => true,
      summarise,
    );

    togglePick('jmdict');

    expect([...pickedForExport.value]).toEqual(['jmdict']);
  });

  test('ticking twice unticks', () => {
    const { togglePick, pickedDictionaries } = useDictionarySelection(
      () => senses,
      () => true,
      summarise,
    );

    togglePick('jmdict');
    togglePick('jmdict');

    expect(pickedDictionaries.value.size).toBe(0);
  });
});

describe('whether the toggles are offered at all', () => {
  test('never for a single-dictionary card, where a pick cannot change the outcome', () => {
    const { canPickDictionaries } = useDictionarySelection(
      () => [sense('JMdict', 'jmdict')],
      () => true,
      summarise,
    );

    expect(canPickDictionaries.value).toBe(false);
  });

  test('nor when there is nowhere for a pick to go', () => {
    const { canPickDictionaries } = useDictionarySelection(
      () => [sense('JMdict', 'jmdict'), sense('Daijirin', 'daijirin')],
      () => false,
      summarise,
    );

    expect(canPickDictionaries.value).toBe(false);
  });

  test('"select all" stops being offered once everything is ticked', () => {
    const { selectAllDictionaries, canSelectAllDictionaries } = useDictionarySelection(
      () => [sense('JMdict', 'jmdict'), sense('Daijirin', 'daijirin')],
      () => true,
      summarise,
    );

    expect(canSelectAllDictionaries.value).toBe(true);
    selectAllDictionaries();
    expect(canSelectAllDictionaries.value).toBe(false);
  });
});

describe('the summary line', () => {
  test('counts the ticks against the dictionaries on the card', () => {
    const senses = ref([sense('JMdict', 'jmdict'), sense('Daijirin', 'daijirin')]);
    const { togglePick, pickSummary } = useDictionarySelection(
      () => senses.value,
      () => true,
      summarise,
    );

    togglePick('jmdict');

    expect(pickSummary.value).toBe('1/2');
  });
});
