import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterEach, spyOn, vi } from 'bun:test';
import * as schemas from 'generated/schemas';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures, type LoadedFixtures } from '../fixtures/loader';
import { assertDifference, assertNoDifference } from '../helpers/assertions';
import { assertMatchesSchema } from '../helpers/openapiContract';
import { Collection, CollectionSegment, CollectionVisibility, Segment } from '@app/models';
import { ContentRating, SegmentStatus, SegmentStorage } from '@app/models/Segment';
import { SegmentDocument } from '@app/models/SegmentDocument';

setupTestSuite();

const app = createTestApp();
let core: CoreFixtures;
let fixtures: LoadedFixtures;

beforeAll(async () => {
  core = await seedCoreFixtures();
});

beforeEach(async () => {
  fixtures = await loadFixtures(['mediaWithEpisode'], { users: core.users });
  signInAs(app, core.users.kevin);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function createTestCollection(
  overrides: Partial<{ name: string; userId: number; visibility: CollectionVisibility }> = {},
) {
  return Collection.save({
    name: overrides.name ?? 'Test Collection',
    userId: overrides.userId ?? core.users.kevin.id,
    visibility: overrides.visibility ?? CollectionVisibility.PRIVATE,
  });
}

async function createTestSegment(mediaId: number, uuid: string): Promise<Segment> {
  return Segment.save({
    uuid,
    publicId: `pub-${uuid}`,
    position: 1,
    status: SegmentStatus.ACTIVE,
    startTimeMs: 0,
    endTimeMs: 1000,
    contentJa: 'テスト',
    contentEs: 'prueba',
    contentEn: 'test',
    contentRating: ContentRating.SAFE,
    ratingAnalysis: { scores: {}, tags: {} },
    posAnalysis: { nouns: 0 },
    storage: SegmentStorage.R2,
    hashedId: `hash-${uuid}`,
    episode: 1,
    mediaId,
    storageBasePath: '/test',
  });
}

function toSearchResultSegment(segment: Segment, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: segment.id,
    uuid: segment.uuid,
    publicId: segment.publicId,
    mediaId: segment.mediaId,
    episode: segment.episode,
    position: segment.position,
    contentRating: segment.contentRating,
    status: segment.status,
    startTimeMs: segment.startTimeMs,
    endTimeMs: segment.endTimeMs,
    textJa: { content: segment.contentJa },
    textEs: { content: segment.contentEs ?? '', isMachineTranslated: false },
    textEn: { content: segment.contentEn ?? '', isMachineTranslated: false },
    urls: {
      audioUrl: 'https://example.com/audio.mp3',
      imageUrl: 'https://example.com/image.jpg',
      videoUrl: 'https://example.com/video.mp4',
    },
    ...overrides,
  };
}

describe('GET /v1/collections', () => {
  it('returns collections for the authenticated user with pagination', async () => {
    await createTestCollection({ name: 'Col A' });
    await createTestCollection({ name: 'Col B' });

    const res = await request(app).get('/v1/collections?take=1');
    expect(res.status).toBe(200);
    expect(res.body.collections).toHaveLength(1);
    expect(res.body.pagination.hasMore).toBe(true);

    const page2 = await request(app).get(`/v1/collections?take=10&cursor=${res.body.pagination.cursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.collections).toHaveLength(1);
  });

  it('filters by visibility query param', async () => {
    await createTestCollection({ name: 'Public', visibility: CollectionVisibility.PUBLIC });
    await createTestCollection({ name: 'Private', visibility: CollectionVisibility.PRIVATE });

    const pub = await request(app).get('/v1/collections?visibility=public');
    expect(pub.status).toBe(200);
    expect(pub.body.collections.every((c: { visibility: string }) => c.visibility === 'PUBLIC')).toBe(true);

    const priv = await request(app).get('/v1/collections?visibility=private');
    expect(priv.status).toBe(200);
    expect(priv.body.collections.every((c: { visibility: string }) => c.visibility === 'PRIVATE')).toBe(true);
  });

  it("does not return other users' collections", async () => {
    await createTestCollection({ name: 'David Col', userId: core.users.david.id });
    await createTestCollection({ name: 'Kevin Col', userId: core.users.kevin.id });

    const res = await request(app).get('/v1/collections');
    expect(res.status).toBe(200);
    expect(res.body.collections.every((c: { name: string }) => c.name !== 'David Col')).toBe(true);
  });

  it('returns segmentCount aggregated from collection items', async () => {
    const collection = await createTestCollection({ name: 'Counted Collection' });
    const segment = await createTestSegment(fixtures.media.testShow.id, 'seg-count-1');
    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: segment.id,
      mediaId: segment.mediaId,
      position: 1,
      note: null,
    });

    const res = await request(app).get('/v1/collections');
    expect(res.status).toBe(200);

    const counted = res.body.collections.find((c: { id: number }) => c.id === collection.id);
    expect(counted).toMatchObject({
      id: collection.id,
      segmentCount: 1,
    });
  });
});

describe('POST /v1/collections', () => {
  it('creates a collection with name and default PRIVATE visibility', async () => {
    await assertDifference(
      () => Collection.countBy({ userId: core.users.kevin.id }),
      1,
      async () => {
        const res = await request(app).post('/v1/collections').send({ name: 'My List' });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ name: 'My List', visibility: 'PRIVATE' });
      },
    );
  });

  it('creates a collection with explicit PUBLIC visibility', async () => {
    const res = await request(app).post('/v1/collections').send({ name: 'Public List', visibility: 'PUBLIC' });
    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe('PUBLIC');
  });

  it('returns 201 with the collection DTO', async () => {
    const res = await request(app).post('/v1/collections').send({ name: 'DTO Check' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'DTO Check',
      visibility: 'PRIVATE',
      segmentCount: 0,
    });
    expect(res.body.id).toBeNumber();
    expect(res.body.createdAt).toBeString();
  });
});

describe('GET /v1/collections/:id', () => {
  it('returns collection details with empty segments array when no segments', async () => {
    const collection = await createTestCollection();

    const res = await request(app).get(`/v1/collections/${collection.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: collection.id,
      name: 'Test Collection',
      segments: [],
    });
    assertMatchesSchema(schemas.s_CollectionWithSegments, res.body, 'GET /v1/collections/:id 200');
  });

  it('returns 404 for non-existent collection id', async () => {
    const res = await request(app).get('/v1/collections/999999');
    expect(res.status).toBe(404);
  });

  it('returns 403 for private collections owned by another user', async () => {
    const collection = await createTestCollection({
      userId: core.users.david.id,
      visibility: CollectionVisibility.PRIVATE,
    });
    signInAs(app, core.users.regular);

    const res = await request(app).get(`/v1/collections/${collection.id}`);
    expect(res.status).toBe(403);
  });

  it('allows reading public collections owned by another user', async () => {
    const collection = await createTestCollection({
      userId: core.users.david.id,
      visibility: CollectionVisibility.PUBLIC,
    });
    signInAs(app, core.users.regular);

    const res = await request(app).get(`/v1/collections/${collection.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: collection.id,
      visibility: 'PUBLIC',
    });
  });

  it('returns ordered segments with includes when collection has indexed segment results', async () => {
    const collection = await createTestCollection();
    const seg1 = await createTestSegment(fixtures.media.testShow.id, 'seg-get-1');
    const seg2 = await createTestSegment(fixtures.media.testShow.id, 'seg-get-2');

    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: seg1.id,
      mediaId: seg1.mediaId,
      position: 1,
      note: 'first',
    });
    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: seg2.id,
      mediaId: seg2.mediaId,
      position: 2,
      note: 'second',
    });

    const findByIdsSpy = spyOn(SegmentDocument, 'findByIds').mockResolvedValueOnce({
      segments: [toSearchResultSegment(seg2)],
      includes: { media: {} },
    });

    const res = await request(app).get(`/v1/collections/${collection.id}`);
    expect(res.status).toBe(200);
    expect(findByIdsSpy).toHaveBeenCalledWith([seg1.id, seg2.id]);
    expect(res.body.totalCount).toBe(2);
    expect(res.body.segments).toHaveLength(1);
    expect(res.body.segments[0]).toMatchObject({
      position: 2,
      note: 'second',
      result: {
        uuid: seg2.uuid,
      },
    });
    expect(res.body.includes).toEqual({ media: {} });
  });
});

describe('PATCH /v1/collections/:id', () => {
  it('updates collection name', async () => {
    const collection = await createTestCollection();

    const res = await request(app).patch(`/v1/collections/${collection.id}`).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
  });

  it('updates collection visibility', async () => {
    const collection = await createTestCollection();

    const res = await request(app).patch(`/v1/collections/${collection.id}`).send({ visibility: 'PUBLIC' });
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe('PUBLIC');
  });

  it('returns 403 when non-owner non-admin tries to update', async () => {
    const collection = await createTestCollection({ userId: core.users.david.id });
    signInAs(app, core.users.regular);

    const res = await request(app).patch(`/v1/collections/${collection.id}`).send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent collection', async () => {
    const res = await request(app).patch('/v1/collections/999999').send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /v1/collections/:id', () => {
  it('deletes a collection and returns 204', async () => {
    const collection = await createTestCollection();

    await assertDifference(
      () => Collection.countBy({ userId: core.users.kevin.id }),
      -1,
      async () => {
        const res = await request(app).delete(`/v1/collections/${collection.id}`);
        expect(res.status).toBe(204);
      },
    );
  });

  it('returns 403 when non-owner tries to delete', async () => {
    const collection = await createTestCollection({ userId: core.users.david.id });
    signInAs(app, core.users.regular);

    const res = await request(app).delete(`/v1/collections/${collection.id}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent collection', async () => {
    const res = await request(app).delete('/v1/collections/999999');
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/collections/:id/segments', () => {
  it('adds a segment to a collection', async () => {
    const collection = await createTestCollection();
    const segment = await createTestSegment(fixtures.media.testShow.id, 'seg-add-1');

    await assertDifference(
      () => CollectionSegment.countBy({ collectionId: collection.id }),
      1,
      async () => {
        const res = await request(app)
          .post(`/v1/collections/${collection.id}/segments`)
          .send({ segmentId: segment.publicId });
        expect(res.status).toBe(204);
      },
    );
  });

  it('is idempotent — returns 204 if segment already in collection', async () => {
    const collection = await createTestCollection();
    const segment = await createTestSegment(fixtures.media.testShow.id, 'seg-idem-1');

    await request(app).post(`/v1/collections/${collection.id}/segments`).send({ segmentId: segment.publicId });

    await assertNoDifference(
      () => CollectionSegment.countBy({ collectionId: collection.id }),
      async () => {
        const res = await request(app)
          .post(`/v1/collections/${collection.id}/segments`)
          .send({ segmentId: segment.publicId });
        expect(res.status).toBe(204);
      },
    );
  });

  it('auto-assigns position (MAX + 1)', async () => {
    const collection = await createTestCollection();
    const seg1 = await createTestSegment(fixtures.media.testShow.id, 'seg-pos-1');
    const seg2 = await createTestSegment(fixtures.media.testShow.id, 'seg-pos-2');

    await request(app).post(`/v1/collections/${collection.id}/segments`).send({ segmentId: seg1.publicId });
    await request(app).post(`/v1/collections/${collection.id}/segments`).send({ segmentId: seg2.publicId });

    const items = await CollectionSegment.find({
      where: { collectionId: collection.id },
      order: { position: 'ASC' },
    });

    expect(items).toHaveLength(2);
    expect(items[0].position).toBe(1);
    expect(items[1].position).toBe(2);
  });

  it('returns 403 when non-owner tries to add', async () => {
    const collection = await createTestCollection({ userId: core.users.david.id });
    const segment = await createTestSegment(fixtures.media.testShow.id, 'seg-deny-1');
    signInAs(app, core.users.regular);

    const res = await request(app)
      .post(`/v1/collections/${collection.id}/segments`)
      .send({ segmentId: segment.publicId });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /v1/collections/:id/segments/:segmentId', () => {
  it('updates position', async () => {
    const collection = await createTestCollection();
    const segment = await createTestSegment(fixtures.media.testShow.id, 'seg-upd-1');
    await request(app).post(`/v1/collections/${collection.id}/segments`).send({ segmentId: segment.publicId });

    const res = await request(app)
      .patch(`/v1/collections/${collection.id}/segments/${segment.id}`)
      .send({ position: 42 });
    expect(res.status).toBe(204);

    const item = await CollectionSegment.findOneByOrFail({ collectionId: collection.id, segmentId: segment.id });
    expect(item.position).toBe(42);
  });

  it('updates note (including setting to null)', async () => {
    const collection = await createTestCollection();
    const segment = await createTestSegment(fixtures.media.testShow.id, 'seg-note-1');
    await request(app)
      .post(`/v1/collections/${collection.id}/segments`)
      .send({ segmentId: segment.publicId, note: 'initial' });

    // Set note
    await request(app).patch(`/v1/collections/${collection.id}/segments/${segment.id}`).send({ note: 'updated' });
    let item = await CollectionSegment.findOneByOrFail({ collectionId: collection.id, segmentId: segment.id });
    expect(item.note).toBe('updated');

    // Clear note
    await request(app).patch(`/v1/collections/${collection.id}/segments/${segment.id}`).send({ note: null });
    item = await CollectionSegment.findOneByOrFail({ collectionId: collection.id, segmentId: segment.id });
    expect(item.note).toBeNull();
  });

  it('returns 403 when non-owner tries to update', async () => {
    const collection = await createTestCollection({ userId: core.users.david.id });
    const segment = await createTestSegment(fixtures.media.testShow.id, 'seg-upd-deny');
    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: segment.id,
      mediaId: segment.mediaId,
      position: 1,
      note: null,
    });
    signInAs(app, core.users.regular);

    const res = await request(app)
      .patch(`/v1/collections/${collection.id}/segments/${segment.id}`)
      .send({ position: 99 });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /v1/collections/:id/segments/:segmentId', () => {
  it('removes segment and returns 204', async () => {
    const collection = await createTestCollection();
    const segment = await createTestSegment(fixtures.media.testShow.id, 'seg-rm-1');
    await request(app).post(`/v1/collections/${collection.id}/segments`).send({ segmentId: segment.publicId });

    await assertDifference(
      () => CollectionSegment.countBy({ collectionId: collection.id }),
      -1,
      async () => {
        const res = await request(app).delete(`/v1/collections/${collection.id}/segments/${segment.id}`);
        expect(res.status).toBe(204);
      },
    );
  });

  it('returns 404 for non-existent segment in collection', async () => {
    const collection = await createTestCollection();

    const res = await request(app).delete(`/v1/collections/${collection.id}/segments/999999`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when non-owner tries to remove', async () => {
    const collection = await createTestCollection({ userId: core.users.david.id });
    const segment = await createTestSegment(fixtures.media.testShow.id, 'seg-rm-deny');
    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: segment.id,
      mediaId: segment.mediaId,
      position: 1,
      note: null,
    });
    signInAs(app, core.users.regular);

    const res = await request(app).delete(`/v1/collections/${collection.id}/segments/${segment.id}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /v1/collections/:id/search', () => {
  it('returns empty results for collection with no segments', async () => {
    const collection = await createTestCollection();

    const res = await request(app).get(`/v1/collections/${collection.id}/search`);
    expect(res.status).toBe(200);
    expect(res.body.segments).toEqual([]);
    expect(res.body.includes).toEqual({ media: {} });
  });

  it('returns ordered indexed segments with exact estimated hit metadata', async () => {
    const collection = await createTestCollection();
    const seg1 = await createTestSegment(fixtures.media.testShow.id, 'seg-search-1');
    const seg2 = await createTestSegment(fixtures.media.testShow.id, 'seg-search-2');

    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: seg1.id,
      mediaId: seg1.mediaId,
      position: 1,
      note: null,
    });
    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: seg2.id,
      mediaId: seg2.mediaId,
      position: 2,
      note: null,
    });

    spyOn(SegmentDocument, 'findByIds').mockResolvedValueOnce({
      // Out-of-order and missing seg1 to validate collection ordering/filtering behavior
      segments: [toSearchResultSegment(seg2)],
      includes: { media: {} },
    });

    const res = await request(app).get(`/v1/collections/${collection.id}/search?take=10`);
    expect(res.status).toBe(200);
    expect(res.body.segments).toHaveLength(1);
    expect(res.body.segments[0]).toMatchObject({ uuid: seg2.uuid });
    expect(res.body.includes).toEqual({ media: {} });
    expect(res.body.pagination.estimatedTotalHits).toBe(2);
    expect(res.body.pagination.estimatedTotalHitsRelation).toBe('EXACT');
  });

  it('returns 403 for private collections owned by another user', async () => {
    const collection = await createTestCollection({
      userId: core.users.david.id,
      visibility: CollectionVisibility.PRIVATE,
    });
    signInAs(app, core.users.regular);

    const res = await request(app).get(`/v1/collections/${collection.id}/search`);
    expect(res.status).toBe(403);
  });

  it('allows searching public collections owned by another user', async () => {
    const collection = await createTestCollection({
      userId: core.users.david.id,
      visibility: CollectionVisibility.PUBLIC,
    });
    signInAs(app, core.users.regular);

    const res = await request(app).get(`/v1/collections/${collection.id}/search`);
    expect(res.status).toBe(200);
    expect(res.body.segments).toEqual([]);
  });
});

describe('GET /v1/collections/:id/stats', () => {
  it('returns empty results for collection with no segments', async () => {
    const collection = await createTestCollection();

    const res = await request(app).get(`/v1/collections/${collection.id}/stats`);
    expect(res.status).toBe(200);
    expect(res.body.media).toEqual([]);
    expect(res.body.categories).toEqual([]);
  });

  it('returns aggregated stats only for the collection segment uuids', async () => {
    const collection = await createTestCollection();
    const seg1 = await createTestSegment(fixtures.media.testShow.id, 'seg-stats-1');
    const seg2 = await createTestSegment(fixtures.media.testShow.id, 'seg-stats-2');

    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: seg1.id,
      mediaId: seg1.mediaId,
      position: 1,
      note: null,
    });
    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: seg2.id,
      mediaId: seg2.mediaId,
      position: 2,
      note: null,
    });

    spyOn(SegmentDocument, 'findByIds').mockResolvedValueOnce({
      segments: [
        toSearchResultSegment(seg1, { mediaId: 101, episode: 1 }),
        toSearchResultSegment(seg2, { mediaId: 101, episode: 2 }),
        toSearchResultSegment(seg2, { id: 99999, uuid: 'seg-stats-extra', mediaId: 202, episode: 1 }),
      ],
      includes: { media: {} },
    });

    const res = await request(app).get(`/v1/collections/${collection.id}/stats`);
    expect(res.status).toBe(200);
    expect(res.body.includes).toEqual({ media: {} });
    expect(res.body.media).toEqual([{ mediaId: 101, publicId: '', matchCount: 2, episodeHits: { '1': 1, '2': 1 } }]);
    expect(res.body.categories).toEqual([{ category: 'ANIME', count: 2 }]);
  });

  it('returns 403 for private collections owned by another user', async () => {
    const collection = await createTestCollection({
      userId: core.users.david.id,
      visibility: CollectionVisibility.PRIVATE,
    });
    signInAs(app, core.users.regular);

    const res = await request(app).get(`/v1/collections/${collection.id}/stats`);
    expect(res.status).toBe(403);
  });

  it('allows stats for public collections owned by another user', async () => {
    const collection = await createTestCollection({
      userId: core.users.david.id,
      visibility: CollectionVisibility.PUBLIC,
    });
    signInAs(app, core.users.regular);

    const res = await request(app).get(`/v1/collections/${collection.id}/stats`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      media: [],
      categories: [],
    });
  });
});
