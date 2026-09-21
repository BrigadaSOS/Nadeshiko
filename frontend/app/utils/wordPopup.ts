/**
 * How the word card is drawn, as far as the reader gets to decide it.
 *
 * Both the settings control and the Shirabe card use this stored preference.
 */

export type DefinitionSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export const DEFINITION_SIZES: readonly DefinitionSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

/**
 * MEDIUM by default, and it is a size larger than the card used to print.
 *
 * 13px suited what the card held when it held one thing: a three-word English
 * gloss. A linked reader's card now carries 大辞林 and 精選版 writing Japanese
 * prose, several paragraphs of it, and prose is read rather than glanced at.
 * SMALL is exactly what the card printed before this existed, for anyone who
 * preferred it.
 */
export const DEFAULT_DEFINITION_SIZE: DefinitionSize = 'MEDIUM';

/** Whatever was stored, narrowed to something we can actually render. An
 *  unrecognised value is a preference written by a newer version, or by hand;
 *  either way the default is a better answer than an invalid font size. */
export function definitionSize(raw: unknown): DefinitionSize {
  return DEFINITION_SIZES.includes(raw as DefinitionSize) ? (raw as DefinitionSize) : DEFAULT_DEFINITION_SIZE;
}
