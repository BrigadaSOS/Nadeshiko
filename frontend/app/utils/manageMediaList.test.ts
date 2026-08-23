import { describe, expect, it } from 'vitest';
import { type MarkedMedia, mergeMarkedMedia } from './manageMediaList';

const named = (...ids: string[]): Map<string, MarkedMedia> =>
  new Map(ids.map((publicId) => [publicId, { publicId, nameEn: publicId }]));

describe('mergeMarkedMedia', () => {
  it('returns nothing when neither list has anything', () => {
    expect(mergeMarkedMedia([], [], new Map())).toEqual([]);
  });

  it('lists favorites first, then hidden titles, in the order each was given', () => {
    // Both orders come from the server: favorites newest-first, hidden in the
    // order they were hidden. Neither is re-sorted here.
    const merged = mergeMarkedMedia(
      ['fav-new', 'fav-old'],
      ['hid-first', 'hid-last'],
      named('fav-new', 'fav-old', 'hid-first', 'hid-last'),
    );

    expect(merged.map((item) => item.publicId)).toEqual(['fav-new', 'fav-old', 'hid-first', 'hid-last']);
  });

  it('lists a title that is both favorited and hidden once', () => {
    const merged = mergeMarkedMedia(['both'], ['both'], named('both'));

    expect(merged).toHaveLength(1);
    expect(merged[0]?.publicId).toBe('both');
  });

  it('carries every name variant through, so the row can pick one to show', () => {
    const names = new Map([
      ['x', { publicId: 'x', nameEn: 'Death Note', nameJa: 'デスノート', nameRomaji: 'Desu Nooto' }],
    ]);

    expect(mergeMarkedMedia(['x'], [], names)).toEqual([
      { publicId: 'x', nameEn: 'Death Note', nameJa: 'デスノート', nameRomaji: 'Desu Nooto' },
    ]);
  });

  it('keeps an id the catalogue has no name for', () => {
    // A title deleted since the reader marked it, or a resolve that failed. The
    // row falls back to `Media #{id}` and its unhide button still works, which is
    // the only way left to clear the entry.
    expect(mergeMarkedMedia([], ['gone'], new Map())).toEqual([{ publicId: 'gone' }]);
  });
});
