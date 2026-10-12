import { computed, ref, type ComputedRef } from 'vue';
import { dictionaryKey, type CardSense } from '~/utils/wordCard';

/** Nothing ticked, and nothing to trim by. Shared so every "export everything"
 *  answer is the same object rather than a fresh empty set per read. */
const NO_PICK: ReadonlySet<string> = new Set<string>();

/**
 * Empty and full picks both export everything; a partial pick excludes dictionaries. Getters
 * track lookup results and configuration changes.
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

  /** Deduplicate by dictionary key, not title: different uploads can share a name. */
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
   * Restore all toggles; like an empty pick, a full pick exports everything. Offer only while
   * some dictionaries remain unticked.
   */
  const selectAllDictionaries = () => {
    pickedDictionaries.value = new Set(cardDictionaries.value.map((dictionary) => dictionary.key));
  };

  const canSelectAllDictionaries = computed(() => pickedDictionaries.value.size < cardDictionaries.value.length);

  /**
   * A single dictionary offers no meaningful choice. The caller also gates on whether mining
   * can use definitions.
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
