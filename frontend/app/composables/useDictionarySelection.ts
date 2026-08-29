import { computed, ref, type ComputedRef } from 'vue';
import { dictionaryKey, type CardSense } from '~/utils/wordCard';

/** Nothing ticked, and nothing to trim by. Shared so every "export everything"
 *  answer is the same object rather than a fresh empty set per read. */
const NO_PICK: ReadonlySet<string> = new Set<string>();

/**
 * Which of the card's dictionaries a mine should carry.
 *
 * A shortlist, not a filter: an empty pick and a full pick mean the same thing
 * (`pickedForExport`), so the reader is choosing what to LEAVE OUT rather than
 * building a list from nothing.
 *
 * `senses` and `offered` are read through getters because both change while the
 * card is open -- the senses when a lookup lands or the reader picks another
 * candidate, and `offered` with the Anki configuration behind it.
 */
export function useDictionarySelection(
  senses: () => readonly CardSense[],
  offered: () => boolean,
  summarise: (picked: number, total: number) => string,
) {
  const pickedDictionaries = ref<Set<string>>(new Set());

  const clearPicked = () => {
    if (pickedDictionaries.value.size > 0) pickedDictionaries.value = new Set();
  };

  /** Reassigned rather than mutated: a `Set` is not deeply reactive, so a card
   *  that ticked in place would not repaint. */
  const togglePick = (key: string) => {
    const next = new Set(pickedDictionaries.value);
    if (!next.delete(key)) next.add(key);
    pickedDictionaries.value = next;
  };

  /**
   * The dictionaries on the card, in the order they are printed.
   *
   * Deduplicated on the key rather than the name for the reason `dictionaryKey`
   * exists: two of a reader's own uploads can share a title, and fusing them into
   * one toggle would hand somebody who ticked one the senses of both.
   */
  const cardDictionaries = computed(() => {
    const seen = new Map<string, string>();
    for (const sense of senses()) {
      const key = dictionaryKey(sense);
      if (!seen.has(key)) seen.set(key, sense.dictionary);
    }
    return [...seen].map(([key, name]) => ({ key, name }));
  });

  const deselectAllDictionaries = () => {
    pickedDictionaries.value = new Set();
  };

  /**
   * Tick every dictionary on the card.
   *
   * Exports the same note "Deselect all" does -- `pickedForExport` reads a full
   * pick and an empty one as the same instruction -- so this is not another way to
   * choose, it is the way BACK from a pick that went one dictionary too far.
   * Ticking three of four by hand to undo a stray untick is the tedium it removes.
   *
   * Offered only while something is left to tick, since a button that cannot
   * change the row it sits in is a button that lies about being able to.
   */
  const selectAllDictionaries = () => {
    pickedDictionaries.value = new Set(cardDictionaries.value.map((dictionary) => dictionary.key));
  };

  const canSelectAllDictionaries = computed(() => pickedDictionaries.value.size < cardDictionaries.value.length);

  /**
   * Whether to offer the toggles at all.
   *
   * Never for a single-dictionary card, which is most of them: ticking the only
   * dictionary there is means the same thing as ticking nothing, so the control
   * would be a checkbox that cannot change the outcome. The rest of the gate --
   * that there is a note to mine and somewhere on it for a definition to go --
   * is the caller's, since a pick with nowhere to go is a control that does
   * nothing.
   */
  const canPickDictionaries = computed(() => offered() && cardDictionaries.value.length > 1);

  const pickedForExport: ComputedRef<ReadonlySet<string>> = computed(() => {
    const size = pickedDictionaries.value.size;
    if (size === 0 || size === cardDictionaries.value.length) return NO_PICK;
    return pickedDictionaries.value;
  });

  /** The card stating what it will export. */
  const pickSummary = computed(() => summarise(pickedDictionaries.value.size, cardDictionaries.value.length));

  return {
    pickedDictionaries,
    cardDictionaries,
    clearPicked,
    togglePick,
    selectAllDictionaries,
    deselectAllDictionaries,
    canSelectAllDictionaries,
    canPickDictionaries,
    pickedForExport,
    pickSummary,
  };
}
