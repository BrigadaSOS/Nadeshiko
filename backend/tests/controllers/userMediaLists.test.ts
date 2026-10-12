import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schemas from 'generated/schemas';
import { request } from '../helpers/http';
import { assertMatchesSchema } from '../helpers/openapiContract';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { CategoryType, Media } from '@app/models/Media';
import { SegmentStorage } from '@app/models/Segment';
import { User } from '@app/models/User';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;
const STALE_PUBLIC_ID = 'stale-boundary-id';

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type BoundaryMedia = Awaited<ReturnType<typeof seedBoundaryMedia>>;

async function seedBoundaryMedia() {
  const loaded = await loadFixtures(['twoMedias']);
  const first = loaded.media.spyXFamily;
  const second = loaded.media.anotherShow;

  Object.assign(first, {
    slug: 'boundary-spy-x-family',
    nameJa: '境界スパイファミリー',
    nameRomaji: 'Boundary Spy x Family',
    nameEn: 'Boundary Spy x Family',
    category: CategoryType.ANIME,
    storage: SegmentStorage.LOCAL,
    storageBasePath: 'boundary/spy-x-family',
  });
  Object.assign(second, {
    slug: 'boundary-another-show',
    nameJa: '境界別作品',
    nameRomaji: 'Boundary Another Show',
    nameEn: 'Boundary Another Show',
    category: CategoryType.JDRAMA,
    storage: SegmentStorage.LOCAL,
    storageBasePath: 'boundary/another-show',
  });
  await first.save();
  await second.save();

  return {
    first,
    second,
    firstSummary: {
      publicId: first.publicId,
      slug: 'boundary-spy-x-family',
      nameJa: '境界スパイファミリー',
      nameRomaji: 'Boundary Spy x Family',
      nameEn: 'Boundary Spy x Family',
      coverUrl: '/media/boundary/spy-x-family/cover.webp',
      category: 'ANIME',
    },
    secondSummary: {
      publicId: second.publicId,
      slug: 'boundary-another-show',
      nameJa: '境界別作品',
      nameRomaji: 'Boundary Another Show',
      nameEn: 'Boundary Another Show',
      coverUrl: '/media/boundary/another-show/cover.webp',
      category: 'JDRAMA',
    },
  };
}

async function setPreferences(preferences: Record<string, unknown>) {
  await User.update({ id: fixtures.users.kevin.id }, { preferences: preferences as never });
  signInAs(app, await User.findOneByOrFail({ id: fixtures.users.kevin.id }));
}

const listCases = [
  {
    path: '/v1/user/excluded-media',
    responseKey: 'excludedMedia',
    preferenceKey: 'hiddenMedia',
    populated: (media: BoundaryMedia) => [
      { mediaPublicId: media.second.publicId },
      { mediaPublicId: STALE_PUBLIC_ID },
      { mediaPublicId: media.first.publicId },
      { mediaPublicId: media.first.publicId },
    ],
    expected: (media: BoundaryMedia) => [media.secondSummary, media.firstSummary, media.firstSummary],
    queryIds: (media: BoundaryMedia) => [
      media.second.publicId,
      STALE_PUBLIC_ID,
      media.first.publicId,
      media.first.publicId,
    ],
  },
  {
    path: '/v1/user/favorite-media',
    responseKey: 'favoriteMedia',
    preferenceKey: 'favoriteMedia',
    populated: (media: BoundaryMedia) => [
      media.first.publicId,
      { mediaPublicId: media.second.publicId, favoritedAt: '2025-01-02T03:04:05.000Z' },
      { mediaPublicId: media.second.publicId, favoritedAt: '2026-01-02T03:04:05.000Z' },
      { mediaPublicId: media.first.publicId, favoritedAt: '2026-01-02T03:04:05.000Z' },
      { mediaPublicId: media.second.publicId, favoritedAt: '2026-01-02T03:04:05.000Z' },
      { mediaPublicId: STALE_PUBLIC_ID, favoritedAt: '2027-01-02T03:04:05.000Z' },
    ],
    expected: (media: BoundaryMedia) => [
      media.secondSummary,
      media.firstSummary,
      media.secondSummary,
      media.secondSummary,
      media.firstSummary,
    ],
    queryIds: (media: BoundaryMedia) => [
      STALE_PUBLIC_ID,
      media.second.publicId,
      media.first.publicId,
      media.second.publicId,
      media.second.publicId,
      media.first.publicId,
    ],
  },
] as const;

describe.each(listCases)('GET $path', ({ path, responseKey, preferenceKey, populated, expected, queryIds }) => {
  it.each([
    ['absent', undefined],
    ['explicitly empty', []],
  ])('returns an exact empty body for %s, then resolves a populated list', async (_label, emptyValue) => {
    const media = await seedBoundaryMedia();
    await setPreferences(emptyValue === undefined ? {} : { [preferenceKey]: emptyValue });

    const findSpy = vi.spyOn(Media, 'find');
    const empty = await request(app).get(path);

    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ [responseKey]: [] });
    expect(findSpy).not.toHaveBeenCalled();

    await setPreferences({ [preferenceKey]: populated(media) });
    const populatedResponse = await request(app).get(path);

    expect(populatedResponse.status).toBe(200);
    expect(populatedResponse.body).toEqual({ [responseKey]: expected(media) });
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith({
      where: queryIds(media).map((publicId) => ({ publicId })),
      relations: {},
    });
    for (const summary of populatedResponse.body[responseKey]) {
      assertMatchesSchema(schemas.s_MediaSummary, summary, `${path} summary`);
    }
  });
});

describe('legacy user media list preferences', () => {
  it('resolves current names from fat and bare entries without mutating stored preferences', async () => {
    const media = await seedBoundaryMedia();
    const preferences = {
      hiddenMedia: [
        { mediaPublicId: media.first.publicId, nameEn: 'Stale hidden title' },
        media.second.publicId,
        { mediaPublicId: STALE_PUBLIC_ID, nameEn: 'Deleted title' },
      ],
      favoriteMedia: [
        {
          mediaPublicId: media.second.publicId,
          nameEn: 'Stale favorite title',
          favoritedAt: '2026-01-02T03:04:05.000Z',
        },
        media.first.publicId,
      ],
    } as never;
    await setPreferences(preferences);

    const excluded = await request(app).get('/v1/user/excluded-media');
    const favorite = await request(app).get('/v1/user/favorite-media');

    expect(excluded.status).toBe(200);
    expect(excluded.body).toEqual({ excludedMedia: [media.firstSummary, media.secondSummary] });
    expect(favorite.status).toBe(200);
    expect(favorite.body).toEqual({ favoriteMedia: [media.secondSummary, media.firstSummary] });

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences).toEqual(preferences);
  });
});
