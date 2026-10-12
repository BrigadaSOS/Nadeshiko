/** Share definition-size choices between the card and settings control. */

export type DefinitionSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export const DEFINITION_SIZES: readonly DefinitionSize[] = ['SMALL', 'MEDIUM', 'LARGE'];

/** Default to 14px for longer monolingual definitions; SMALL retains the previous 13px rendering. */
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
