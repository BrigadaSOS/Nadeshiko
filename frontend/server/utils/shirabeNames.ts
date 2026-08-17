/**
 * The dictionary Shirabe files people under, and NOT a reliable test on its own.
 *
 * Kept only as the fallback for a Shirabe old enough not to send `name`: JMdict
 * carries ~7,300 JMnedict rows under its own slug (`jmdict:5747047` IS
 * `jmnedict:5747047`, とき, the Jōetsu-line Shinkansen), so filtering on the slug
 * keeps every one of them and never tells you. Shirabe warns about exactly this
 * in `WordIds`, and now publishes the flag it already computed.
 */
const NAME_DICTIONARY = 'jmnedict';

/**
 * Drop the name entries from a candidate list.
 *
 * Shirabe ranks names below real words and never lets one outrank a word
 * (`WordIds` RULES_VERSION 3), so they only ever arrive as a tail -- but a tail
 * that dominates: きみ answers twelve candidates and six are people called Kimi,
 * all glossing "Kimi" and all indistinguishable in a picker.
 *
 * Dropped rather than merely de-emphasised because of what this corpus IS. Anime
 * and drama subtitles are full of names, and a reader hovering one wants to know
 * it is a name -- which the card already says by having no entry, alongside the
 * dictionary links that can answer properly -- not to read six JMnedict rows
 * about strangers.
 *
 * A list that was ALL names comes back empty, and the caller reads that the same
 * way it reads a token that resolved to nothing, because it is the same answer:
 * no word here to define.
 */
export function withoutNameEntries<T extends { name?: boolean; dictionary?: string }>(candidates: readonly T[]): T[] {
  return candidates.filter((candidate) =>
    candidate.name === undefined ? candidate.dictionary !== NAME_DICTIONARY : !candidate.name,
  );
}
