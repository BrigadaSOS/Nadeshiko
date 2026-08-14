import { describe, expect, it } from 'vitest';
import { secondaryMediaNames } from './mediaNames';

describe('secondaryMediaNames', () => {
  const deathNote = { nameEn: 'Death Note', nameJa: 'DEATH NOTE', nameRomaji: 'DEATH NOTE' };

  it('drops the language the reader already sees', () => {
    expect(
      secondaryMediaNames(
        { nameEn: 'Bocchi the Rock', nameJa: 'ぼっち・ざ・ろっく', nameRomaji: 'Bocchi za Rokku' },
        'ENGLISH',
      ),
    ).toEqual(['ぼっち・ざ・ろっく', 'Bocchi za Rokku']);
  });

  it('collapses a title whose other two names are the same string', () => {
    // The reason this function exists: rendered "DEATH NOTE | DEATH NOTE".
    expect(secondaryMediaNames(deathNote, 'ENGLISH')).toEqual(['DEATH NOTE']);
  });

  it('treats names differing only in case as one', () => {
    expect(
      secondaryMediaNames({ nameEn: 'Shirobako', nameJa: 'SHIROBAKO', nameRomaji: 'Shirobako' }, 'JAPANESE'),
    ).toEqual(['Shirobako']);
  });

  it('keeps the first spelling in language order when duplicates disagree on case', () => {
    // English comes before Japanese in ORDER, so `Death Note` is the one kept
    // and the shoutier `DEATH NOTE` is the duplicate that goes.
    expect(secondaryMediaNames(deathNote, 'ROMAJI')).toEqual(['Death Note']);
  });

  it('ignores blank and whitespace-only names', () => {
    expect(secondaryMediaNames({ nameEn: 'Steins;Gate', nameJa: '   ', nameRomaji: '' }, 'JAPANESE')).toEqual([
      'Steins;Gate',
    ]);
  });

  it('returns nothing when a title has only the name already shown', () => {
    expect(secondaryMediaNames({ nameEn: 'Monster' }, 'ENGLISH')).toEqual([]);
  });
});
