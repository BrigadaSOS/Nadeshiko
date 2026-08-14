import { describe, expect, it } from 'vitest';
import { mergeMarkedMedia } from './manageMediaList';

const favorite = (id: string, favoritedAt?: string) => ({ mediaPublicId: id, nameEn: id, favoritedAt });
const hiddenItem = (id: string, hiddenAt?: string) => ({ mediaPublicId: id, nameEn: id, hiddenAt });

describe('mergeMarkedMedia', () => {
  it('returns nothing when neither list has anything', () => {
    expect(mergeMarkedMedia([], [])).toEqual([]);
  });

  it('orders by when the title was marked, most recent first', () => {
    const merged = mergeMarkedMedia(
      [favorite('old', '2026-01-01T00:00:00Z'), favorite('new', '2026-03-01T00:00:00Z')],
      [hiddenItem('middle', '2026-02-01T00:00:00Z')],
    );

    expect(merged.map((item) => item.publicId)).toEqual(['new', 'middle', 'old']);
  });

  it('interleaves the two lists rather than grouping them', () => {
    const merged = mergeMarkedMedia(
      [favorite('fav-newest', '2026-03-01T00:00:00Z'), favorite('fav-oldest', '2026-01-01T00:00:00Z')],
      [hiddenItem('hidden-middle', '2026-02-01T00:00:00Z')],
    );

    expect(merged.map((item) => item.publicId)).toEqual(['fav-newest', 'hidden-middle', 'fav-oldest']);
  });

  it('lists a title that is both favorited and hidden once', () => {
    const merged = mergeMarkedMedia(
      [favorite('both', '2026-01-01T00:00:00Z')],
      [hiddenItem('both', '2026-02-01T00:00:00Z')],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.publicId).toBe('both');
  });

  it('orders a title marked twice by the later of the two', () => {
    // Favorited long ago, hidden just now: it belongs at the top, with the
    // titles the reader has been touching.
    const merged = mergeMarkedMedia(
      [favorite('both', '2026-01-01T00:00:00Z'), favorite('other', '2026-02-01T00:00:00Z')],
      [hiddenItem('both', '2026-03-01T00:00:00Z')],
    );

    expect(merged.map((item) => item.publicId)).toEqual(['both', 'other']);
  });

  it('keeps titles whose timestamp is missing or unparseable, sorted last', () => {
    const merged = mergeMarkedMedia(
      [favorite('undated'), favorite('nonsense', 'not-a-date'), favorite('dated', '2026-01-01T00:00:00Z')],
      [],
    );

    expect(merged).toHaveLength(3);
    expect(merged[0]?.publicId).toBe('dated');
    expect(merged.map((item) => item.publicId)).toContain('undated');
    expect(merged.map((item) => item.publicId)).toContain('nonsense');
  });

  it('carries every name variant through, so the row can pick one to show', () => {
    const merged = mergeMarkedMedia(
      [{ mediaPublicId: 'x', nameEn: 'Death Note', nameJa: 'デスノート', nameRomaji: 'Desu Nooto' }],
      [],
    );

    expect(merged[0]).toEqual({
      publicId: 'x',
      nameEn: 'Death Note',
      nameJa: 'デスノート',
      nameRomaji: 'Desu Nooto',
    });
  });
});
