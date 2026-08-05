import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import { Media } from '@app/models';
import { normalizeLanguageFilter, resolveMediaFilterIds } from '@app/controllers/searchFilters';
import type { t_SearchFilters } from 'generated/models';

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>;

function mockMediaInfoMap(entries: Array<[number, { publicId: string; anilist?: string }]>): void {
  const results = new Map(
    entries.map(([id, info]) => [id, { publicId: info.publicId, externalIds: { anilist: info.anilist ?? null } }]),
  );
  spyOn(Media, 'getMediaInfoMap').mockResolvedValue({ results } as unknown as MediaInfoMap);
}

afterEach(() => {
  spyOn(Media, 'getMediaInfoMap').mockRestore();
});

describe('normalizeLanguageFilter', () => {
  it('leaves an absent filter untouched', () => {
    const filters = { status: ['ACTIVE'] } as t_SearchFilters;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toBeUndefined();
  });

  it('tolerates undefined filters', () => {
    expect(() => normalizeLanguageFilter(undefined)).not.toThrow();
  });

  it('rewrites the legacy exclude form into the canonical include list', () => {
    const filters = { languages: { exclude: ['en'] } } as t_SearchFilters;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toEqual(['ES']);
  });

  it('keeps the array form as an include list', () => {
    const filters = { languages: ['ES'] } as t_SearchFilters;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toEqual(['ES']);
  });

  it('uppercases and drops unknown codes', () => {
    const filters = { languages: ['en', 'fr'] } as unknown as t_SearchFilters;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toEqual(['EN']);
  });

  it('is idempotent', () => {
    const filters = { languages: { exclude: ['es'] } } as t_SearchFilters;
    normalizeLanguageFilter(filters);
    const once = filters.languages;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toEqual(once);
  });
});

describe('resolveMediaFilterIds', () => {
  it('does nothing without a media filter', async () => {
    const filters = { status: ['ACTIVE'] } as t_SearchFilters;
    await resolveMediaFilterIds(filters);
    expect(filters.media).toBeUndefined();
  });

  it('resolves publicIds to internal media ids on include and exclude', async () => {
    mockMediaInfoMap([
      [7, { publicId: 'pub-seven' }],
      [9, { publicId: 'pub-nine' }],
    ]);

    const filters = {
      media: {
        include: [{ mediaPublicId: 'pub-seven' }],
        exclude: [{ mediaPublicId: 'pub-nine' }],
      },
    } as t_SearchFilters;

    await resolveMediaFilterIds(filters);

    expect(filters.media?.include).toEqual([{ mediaPublicId: 'pub-seven', mediaId: 7 }] as never);
    expect(filters.media?.exclude).toEqual([{ mediaPublicId: 'pub-nine', mediaId: 9 }] as never);
  });

  it('falls back to matching the anilist external id', async () => {
    mockMediaInfoMap([[3, { publicId: 'pub-three', anilist: '12345' }]]);

    const filters = { media: { include: [{ mediaPublicId: '12345' }] } } as t_SearchFilters;
    await resolveMediaFilterIds(filters);

    expect(filters.media?.include).toEqual([{ mediaPublicId: '12345', mediaId: 3 }] as never);
  });

  it('drops filter items that resolve to no media', async () => {
    mockMediaInfoMap([[7, { publicId: 'pub-seven' }]]);

    const filters = {
      media: { include: [{ mediaPublicId: 'pub-seven' }, { mediaPublicId: 'does-not-exist' }] },
    } as t_SearchFilters;

    await resolveMediaFilterIds(filters);

    expect(filters.media?.include).toEqual([{ mediaPublicId: 'pub-seven', mediaId: 7 }] as never);
  });
});
