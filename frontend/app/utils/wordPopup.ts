/**
 * How the word card is drawn, as far as the reader gets to decide it.
 *
 * One module because two places need the same answer and must not drift: the
 * card, which renders at this size, and the settings control, which offers the
 * choices. A component holding its own copy of the sizes is how a "Large" that
 * is no longer large happens.
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
const SIZES: Record<DefinitionSize, string> = {
  SMALL: '13px',
  MEDIUM: '14px',
  LARGE: '16px',
};

export const DEFAULT_DEFINITION_SIZE: DefinitionSize = 'MEDIUM';

/** Whatever was stored, narrowed to something we can actually render. An
 *  unrecognised value is a preference written by a newer version, or by hand;
 *  either way the default is a better answer than an invalid font size. */
export function definitionSize(raw: unknown): DefinitionSize {
  return DEFINITION_SIZES.includes(raw as DefinitionSize) ? (raw as DefinitionSize) : DEFAULT_DEFINITION_SIZE;
}

/** The CSS length for a stored preference, for `--definition-size`. */
export function definitionFontSize(raw: unknown): string {
  return SIZES[definitionSize(raw)];
}
