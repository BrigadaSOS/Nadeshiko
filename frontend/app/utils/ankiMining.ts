/**
 * The search Anki is asked to answer "have I already mined this word?" with.
 *
 * Kept out of the composable that fires it so the one thing that can be wrong
 * here silently -- which notes the query considers to be about this word -- can
 * be tested without a running Anki. A query that is too loose paints the
 * already-mined star over a word the reader has never seen; one that is too
 * tight sends every mine to the last added card and quietly loses the whole
 * point of the button.
 */

/**
 * Anki's search syntax, escaped.
 *
 * `"`, `*`, `_` and `\` are operators inside a search term, and `:` splits a
 * term from the field it applies to -- so a word carrying any of them would
 * otherwise be read as syntax rather than as text. Japanese words rarely do,
 * but the dictionary form comes off a parse of arbitrary subtitles and a lone
 * `*` there would match every note in the deck.
 *
 * One pass with a callback rather than a chain of replaces, so the backslashes
 * this adds are never themselves escaped by a later step.
 */
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
 * Notes for this word, or null when the profile cannot answer the question.
 *
 * Exact, or exact followed by a furigana bracket: a mined expression field
 * holds either `手加減` or `手加減[てかげん]`, and both are this word. A
 * contains-match (`*手加減*`) would be the easy way to catch both and is the
 * wrong one -- it makes every short word a false positive, with 手 matching
 * 手加減, 上手 and 相手 alike, and the star is then a lie about the reader's own
 * collection.
 *
 * The deck goes in unescaped, deliberately: it comes from Anki's own
 * `deckNames` rather than from the reader typing, and escaping it would turn
 * the `::` of a subdeck into a literal and match nothing.
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

/**
 * Every note in a deck, including its subdecks.
 *
 * Same quoting as `minedNoteQuery` above and for the same reason: the whole
 * term is quoted and the deck name goes in as Anki gave it, because escaping
 * would turn the `::` of a subdeck into a literal and match nothing. A reader
 * who picks a parent deck means the tree under it.
 */
export function deckNotesQuery(deck: string): string | null {
  const scope = deck.trim();
  return scope ? `"deck:${scope}"` : null;
}

/**
 * The note type most of these notes are, or null when they are of none.
 *
 * A deck has no single note type -- this is a vote, used to prefill a picker the
 * reader can still change. Ties go to the type seen first, which on a sample
 * taken from the end of the deck is the older of the two: a reader midway
 * through switching note types has the newer one arriving in a run at the very
 * end, and letting a 50/50 tip on that run would suggest a type they have used
 * only a handful of times.
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
