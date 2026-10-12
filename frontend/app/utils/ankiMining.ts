/** Pure Anki queries for checking whether a word has already been mined. */

/** Escape Anki search operators in one pass so inserted backslashes are not escaped again. */
export function escapeAnkiTerm(value: string): string {
  return value.replace(/["*_\\:]/g, (character) => `\\${character}`);
}

export type MinedQueryInput = {
  /** The dictionary form, which is what the card's headword shows and what a
   *  Yomitan mine puts in the expression field. */
  word: string;
  /** The profile's expression field -- the one the reader named in settings as
   *  holding the word. Without it there is nothing to match against and the
   *  check cannot be made at all. */
  key?: string;
  /** Scoped to the deck Nadeshiko exports to, which is the deck Yomitan is
   *  mining into for anyone using the two together. `deck:` covers subdecks, so
   *  a per-year or per-source split under it still matches. */
  deck?: string;
};

/**
 * Match the exact word or its furigana-bracket form, never a substring. Require an expression field. Deck
 * names come from Anki and stay unescaped to preserve `::` subdeck syntax.
 */
export function minedNoteQuery({ word, key, deck }: MinedQueryInput): string | null {
  const term = word.trim();
  const field = key?.trim();
  if (!term || !field) return null;

  const escapedTerm = escapeAnkiTerm(term);
  const escapedField = escapeAnkiTerm(field);

  const parts: string[] = [];
  const scope = deck?.trim();
  if (scope) parts.push(`"deck:${scope}"`);
  parts.push(`("${escapedField}:${escapedTerm}" OR "${escapedField}:${escapedTerm}[*")`);
  return parts.join(' ');
}

/** Quote the deck term without escaping its Anki-provided name; `deck:` includes subdecks. */
export function deckNotesQuery(deck: string): string | null {
  const scope = deck.trim();
  return scope ? `"deck:${scope}"` : null;
}

/**
 * Suggest the most common note type without treating a deck as single-model. Ties keep the first encountered
 * type.
 */
export function mostCommonModel(notes: ReadonlyArray<{ modelName?: string | null }>): string | null {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const model = note?.modelName;
    if (!model) continue;
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}
