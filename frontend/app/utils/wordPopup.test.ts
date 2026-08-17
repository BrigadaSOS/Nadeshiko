import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITION_SIZE, definitionFontSize, definitionSize } from './wordPopup';

/**
 * The card holds a reader's own monolingual dictionaries now, which is Japanese
 * prose rather than a three-word English gloss, so the default moved up a step
 * and the old size stayed available as SMALL.
 */
describe('definition size', () => {
  it('defaults to medium when the reader has never chosen', () => {
    expect(definitionSize(undefined)).toBe(DEFAULT_DEFINITION_SIZE);
    expect(definitionSize(null)).toBe('MEDIUM');
  });

  // Preferences are stored as JSON and edited by more than this form: a value
  // written by a newer version, or by hand, must not reach CSS as a font size.
  it('falls back rather than passing an unknown value through', () => {
    expect(definitionSize('ENORMOUS')).toBe('MEDIUM');
    expect(definitionFontSize('ENORMOUS')).toBe(definitionFontSize('MEDIUM'));
  });

  it('gets larger in the direction it says', () => {
    const px = (size: string) => Number.parseInt(definitionFontSize(size), 10);

    expect(px('SMALL')).toBeLessThan(px('MEDIUM'));
    expect(px('MEDIUM')).toBeLessThan(px('LARGE'));
  });
});
