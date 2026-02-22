# Complete Fixture Catalog Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate all remaining ad-hoc `seedMedia()`, `seedSeries()`, `seedEpisode()` calls from controller tests and delete those helper files, leaving the fixture catalog as the only source of test data.

**Architecture:** Six new named fixture sets cover every remaining test scenario. Each test loads exactly the fixtures it needs via `loadFixtures([...])`. No ad-hoc entity creation in test bodies. After migration, `media.ts`, `series.ts`, and `episode.ts` fixture helpers are deleted entirely.

**Tech Stack:** Bun, Vitest, TypeORM, supertest. All tests in `backend/tests/controllers/`. Run from `backend/` with `bun run test -- tests/controllers/<file>`.

---

### Task 1: Add six new fixture sets to the catalog

**Files:**
- Modify: `tests/fixtures/catalog/index.ts`

**Context:** `singleMedia` and `singleSeries` are the Nadeshiko equivalent of Rails' generic fixture entries — "any media/series" needed as a FK target or to test empty/404 cases. `seriesAndMedia` covers tests that need both entities unlinked. `seriesWithLinkedMedia` covers tests that need the SeriesMedia join row pre-created. `mediaWithEpisode` and `mediaWithThirdEpisode` cover specific episode scenarios. Update the ID allocation comment too.

**Step 1: Add entries to `tests/fixtures/catalog/index.ts`**

Add after the `threeSeriesForPagination` entry and before the closing `} satisfies`:

```typescript
  singleMedia: {
    media: {
      testShow: { ...mediaDefaults },
    },
  },
  singleSeries: {
    series: {
      testSeries: { nameJa: 'シリーズ', nameRomaji: 'Shirizu', nameEn: 'Test Series' },
    },
  },
  seriesAndMedia: {
    media: {
      testShow: { ...mediaDefaults },
    },
    series: {
      testSeries: { nameJa: 'シリーズ', nameRomaji: 'Shirizu', nameEn: 'Test Series' },
    },
  },
  seriesWithLinkedMedia: {
    media: {
      testShow: { ...mediaDefaults },
    },
    series: {
      testSeries: { nameJa: 'シリーズ', nameRomaji: 'Shirizu', nameEn: 'Test Series' },
    },
    seriesMedia: {
      testLink: {
        seriesId: ref('series.testSeries.id'),
        mediaId: ref('media.testShow.id'),
        position: 1,
      },
    },
  },
  mediaWithEpisode: {
    media: {
      testShow: { ...mediaDefaults },
    },
    episodes: {
      pilot: {
        mediaId: ref('media.testShow.id'),
        episodeNumber: 1,
        titleEn: 'Pilot',
        segmentCount: 0,
      },
    },
  },
  mediaWithThirdEpisode: {
    media: {
      testShow: { ...mediaDefaults },
    },
    episodes: {
      thirdOne: {
        mediaId: ref('media.testShow.id'),
        episodeNumber: 3,
        titleEn: 'Third One',
        segmentCount: 0,
      },
    },
  },
```

Also update the ID allocation comment at the top of `FIXTURE_SETS` to document that series and episodes use auto-increment (no explicit IDs needed):

```typescript
// ID allocation for fixtures with explicit PKs (Seiyuu and Character use @PrimaryColumn):
//   seiyuuWithRoles:          seiyuu 2001, character 2001
//   seiyuuNoCharacters:       seiyuu 3001
//   characterNoAppearances:   seiyuu 3002, character 3001
// Series, Media, Episode use generated/auto-increment PKs — no explicit IDs needed.
```

**Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: no errors.

**Step 3: Commit**

```
jj describe -m "test: add singleMedia, singleSeries, seriesAndMedia, seriesWithLinkedMedia, mediaWithEpisode, mediaWithThirdEpisode catalog fixtures"
jj new
```

---

### Task 2: Migrate episodeController.test.ts

**Files:**
- Modify: `tests/controllers/episodeController.test.ts`

**Mapping of old → new:**
- `seedMedia()` alone → `loadFixtures(['singleMedia'])`, access via `fixtures.media.testShow`
- `seedMedia()` + `seedEpisode(media.id, { episodeNumber: 3, titleEn: 'Third One' })` → `loadFixtures(['mediaWithThirdEpisode'])`, access via `fixtures.media.testShow` and `fixtures.episodes.thirdOne`
- `seedMedia()` + `seedEpisode(media.id, { episodeNumber: 1, ... })` → `loadFixtures(['mediaWithEpisode'])`, access via `fixtures.media.testShow` and `fixtures.episodes.pilot`

**Step 1: Replace the entire file**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestSuite, createTestApp } from '../helpers/setup';
import { seedCoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { Episode } from '@app/models/Episode';

setupTestSuite();

const app = createTestApp();

beforeEach(async () => {
  await seedCoreFixtures(app);
});

describe('GET /v1/media/:mediaId/episodes', () => {
  it('returns episodes for a media', async () => {
    const fixtures = await loadFixtures(['mediaWithTwoEpisodes']);
    const media = fixtures.media.episodicShow;

    const res = await request(app).get(`/v1/media/${media.id}/episodes`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      episodes: [{ titleEn: 'First' }, { titleEn: 'Second' }],
      pagination: { hasMore: false, cursor: null },
    });
    expect(res.body.episodes).toHaveLength(2);
  });

  it('returns empty array when media exists but has no episodes', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).get(`/v1/media/${media.id}/episodes`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      episodes: [],
      pagination: { hasMore: false, cursor: null },
    });
  });

  it('returns 404 when media does not exist', async () => {
    const res = await request(app).get('/v1/media/999/episodes');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('paginates with limit and cursor', async () => {
    const fixtures = await loadFixtures(['mediaWithThreeEpisodes']);
    const media = fixtures.media.episodicShow;

    const res = await request(app).get(`/v1/media/${media.id}/episodes?limit=2&cursor=0`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pagination: { hasMore: true, cursor: 2 },
    });
    expect(res.body.episodes).toHaveLength(2);
  });
});

describe('POST /v1/media/:mediaId/episodes', () => {
  it('creates an episode and returns 201', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app)
      .post(`/v1/media/${media.id}/episodes`)
      .send({ episodeNumber: 1, titleEn: 'The Beginning' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      mediaId: media.id,
      episodeNumber: 1,
      titleEn: 'The Beginning',
    });

    const saved = await Episode.findOneBy({ mediaId: media.id, episodeNumber: 1 });
    expect(saved).not.toBeNull();
    expect(saved!.titleEn).toBe('The Beginning');
  });

  it('persists all optional fields', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app)
      .post(`/v1/media/${media.id}/episodes`)
      .send({
        episodeNumber: 5,
        titleEn: 'The Storm',
        titleRomaji: 'Arashi',
        titleJa: '嵐',
        description: 'A big storm approaches',
        lengthSeconds: 1320,
        thumbnailUrl: 'https://example.com/thumb.jpg',
      });

    expect(res.status).toBe(201);

    const saved = await Episode.findOneBy({ mediaId: media.id, episodeNumber: 5 });
    expect(saved!.titleRomaji).toBe('Arashi');
    expect(saved!.titleJa).toBe('嵐');
    expect(saved!.description).toBe('A big storm approaches');
    expect(saved!.lengthSeconds).toBe(1320);
    expect(saved!.thumbnailUrl).toBe('https://example.com/thumb.jpg');
  });

  it('returns 404 when media does not exist (FK violation)', async () => {
    const res = await request(app).post('/v1/media/999/episodes').send({ episodeNumber: 1 });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('airedAt round-trips correctly', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app)
      .post(`/v1/media/${media.id}/episodes`)
      .send({ episodeNumber: 1, airedAt: '2024-06-01T00:00:00.000Z' })
      .expect(201);

    expect(res.body).toMatchObject({ airedAt: '2024-06-01T00:00:00.000Z' });

    const getRes = await request(app).get(`/v1/media/${media.id}/episodes/1`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({ airedAt: '2024-06-01T00:00:00.000Z' });
  });
});

describe('GET /v1/media/:mediaId/episodes/:episodeNumber', () => {
  it('returns the episode', async () => {
    const fixtures = await loadFixtures(['mediaWithThirdEpisode']);
    const media = fixtures.media.testShow;
    const thirdOne = fixtures.episodes.thirdOne;

    const res = await request(app).get(`/v1/media/${media.id}/episodes/${thirdOne.episodeNumber}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      mediaId: media.id,
      episodeNumber: 3,
      titleEn: 'Third One',
    });
  });

  it('returns 404 when episode does not exist', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).get(`/v1/media/${media.id}/episodes/999`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PATCH /v1/media/:mediaId/episodes/:episodeNumber', () => {
  it('updates the episode and returns it', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const pilot = fixtures.episodes.pilot;

    const res = await request(app)
      .patch(`/v1/media/${media.id}/episodes/${pilot.episodeNumber}`)
      .send({ titleEn: 'New Title' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ titleEn: 'New Title' });

    const updated = await Episode.findOneBy({ mediaId: media.id, episodeNumber: pilot.episodeNumber });
    expect(updated!.titleEn).toBe('New Title');
  });

  it('returns 404 when episode does not exist', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app)
      .patch(`/v1/media/${media.id}/episodes/999`)
      .send({ titleEn: 'Nope' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DELETE /v1/media/:mediaId/episodes/:episodeNumber', () => {
  it('soft-deletes the episode and returns 204', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const pilot = fixtures.episodes.pilot;

    const res = await request(app).delete(`/v1/media/${media.id}/episodes/${pilot.episodeNumber}`);

    expect(res.status).toBe(204);

    const found = await Episode.findOneBy({ mediaId: media.id, episodeNumber: pilot.episodeNumber });
    expect(found).toBeNull();

    const withDeleted = await Episode.findOne({
      where: { mediaId: media.id, episodeNumber: pilot.episodeNumber },
      withDeleted: true,
    });
    expect(withDeleted).not.toBeNull();
    expect(withDeleted!.deletedAt).not.toBeNull();
  });

  it('returns 404 when episode does not exist', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).delete(`/v1/media/${media.id}/episodes/999`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

**Step 2: Run episode tests**

```bash
bun run test -- tests/controllers/episodeController.test.ts
```
Expected: 11 tests passing.

**Step 3: Commit**

```
jj describe -m "test: migrate episodeController tests to fixture catalog"
jj new
```

---

### Task 3: Migrate seriesController.test.ts

**Files:**
- Modify: `tests/controllers/seriesController.test.ts`

**Mapping:**
- `seedSeries()` or `seedSeries({ nameEn: 'Old Name' })` → `loadFixtures(['singleSeries'])`, `fixtures.series.testSeries` (the original name doesn't matter — we assert the value after PATCH)
- `seedSeries()` + `seedMedia()` (no link) → `loadFixtures(['seriesAndMedia'])`, `fixtures.series.testSeries` + `fixtures.media.testShow`
- `seedSeries()` + `seedMedia()` + `SeriesMedia.save(...)` → `loadFixtures(['seriesWithLinkedMedia'])`, `fixtures.series.testSeries` + `fixtures.media.testShow`
- `seedMedia()` alone → `loadFixtures(['singleMedia'])`, `fixtures.media.testShow`
- `seedSeries()` alone (FK test where media is 999) → `loadFixtures(['singleSeries'])`, `fixtures.series.testSeries`

**Step 1: Replace the entire file**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestSuite, createTestApp } from '../helpers/setup';
import { seedCoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { Series } from '@app/models/Series';
import { SeriesMedia } from '@app/models/SeriesMedia';

setupTestSuite();

const app = createTestApp();

beforeEach(async () => {
  await seedCoreFixtures(app);
});

describe('GET /v1/media/series', () => {
  it('returns paginated series sorted by name', async () => {
    await loadFixtures(['twoSeriesAlphabetical']);

    const res = await request(app).get('/v1/media/series');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      series: [{ nameEn: 'A Series' }, { nameEn: 'B Series' }],
      pagination: { hasMore: false, cursor: null },
    });
    expect(res.body.series).toHaveLength(2);
  });

  it('filters by query string', async () => {
    await loadFixtures(['twoSeriesForSearch']);

    const res = await request(app).get('/v1/media/series?query=naru');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      series: [{ nameEn: 'Naruto' }],
    });
    expect(res.body.series).toHaveLength(1);
  });

  it('supports cursor pagination', async () => {
    await loadFixtures(['threeSeriesForPagination']);

    const res = await request(app).get('/v1/media/series?limit=2&cursor=0');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pagination: { hasMore: true, cursor: 2 },
    });
    expect(res.body.series).toHaveLength(2);
  });
});

describe('GET /v1/media/series/:id', () => {
  it('returns series with media ordered by position', async () => {
    const fixtures = await loadFixtures(['seriesWithOrderedMedia']);
    const series = fixtures.series.testSeries;
    const mediaA = fixtures.media.mediaA;
    const mediaB = fixtures.media.mediaB;

    const res = await request(app).get(`/v1/media/series/${series.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: series.id,
      media: [
        { position: 1, media: { id: mediaB.id } },
        { position: 2, media: { id: mediaA.id } },
      ],
    });
    expect(res.body.media).toHaveLength(2);
  });

  it('returns 404 when series does not exist', async () => {
    const res = await request(app).get('/v1/media/series/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('POST /v1/media/series', () => {
  it('creates a series and returns 201', async () => {
    const res = await request(app).post('/v1/media/series').send({
      nameJa: '進撃の巨人',
      nameRomaji: 'Shingeki no Kyojin',
      nameEn: 'Attack on Titan',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nameEn: 'Attack on Titan' });

    const saved = await Series.findOneBy({ id: res.body.id });
    expect(saved).not.toBeNull();
    expect(saved!.nameRomaji).toBe('Shingeki no Kyojin');
  });
});

describe('PATCH /v1/media/series/:id', () => {
  it('updates a series and returns it', async () => {
    const fixtures = await loadFixtures(['singleSeries']);
    const series = fixtures.series.testSeries;

    const res = await request(app).patch(`/v1/media/series/${series.id}`).send({ nameEn: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nameEn: 'New Name' });

    const updated = await Series.findOneBy({ id: series.id });
    expect(updated!.nameEn).toBe('New Name');
  });

  it('returns 404 when series does not exist', async () => {
    const res = await request(app).patch('/v1/media/series/999').send({ nameEn: 'Nope' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DELETE /v1/media/series/:id', () => {
  it('deletes the series and returns 204', async () => {
    const fixtures = await loadFixtures(['singleSeries']);
    const series = fixtures.series.testSeries;

    const res = await request(app).delete(`/v1/media/series/${series.id}`);

    expect(res.status).toBe(204);

    const deleted = await Series.findOneBy({ id: series.id });
    expect(deleted).toBeNull();
  });

  it('returns 404 when series does not exist', async () => {
    const res = await request(app).delete('/v1/media/series/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('POST /v1/media/series/:id/media', () => {
  it('adds media to series', async () => {
    const fixtures = await loadFixtures(['seriesAndMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app).post(`/v1/media/series/${series.id}/media`).send({
      mediaId: media.id,
      position: 1,
    });

    expect(res.status).toBe(204);

    const entry = await SeriesMedia.findOneBy({ seriesId: series.id, mediaId: media.id });
    expect(entry).not.toBeNull();
    expect(entry!.position).toBe(1);
  });

  it('returns 404 when series does not exist (FK violation)', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).post('/v1/media/series/999/media').send({
      mediaId: media.id,
      position: 1,
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 404 when media does not exist (FK violation)', async () => {
    const fixtures = await loadFixtures(['singleSeries']);
    const series = fixtures.series.testSeries;

    const res = await request(app).post(`/v1/media/series/${series.id}/media`).send({
      mediaId: 999,
      position: 1,
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PATCH /v1/media/series/:id/media/:mediaId', () => {
  it('updates media position in series', async () => {
    const fixtures = await loadFixtures(['seriesWithLinkedMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app)
      .patch(`/v1/media/series/${series.id}/media/${media.id}`)
      .send({ position: 3 });

    expect(res.status).toBe(204);

    const updated = await SeriesMedia.findOneBy({ seriesId: series.id, mediaId: media.id });
    expect(updated!.position).toBe(3);
  });

  it('returns 404 when relation does not exist', async () => {
    const fixtures = await loadFixtures(['seriesAndMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app)
      .patch(`/v1/media/series/${series.id}/media/${media.id}`)
      .send({ position: 2 });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DELETE /v1/media/series/:id/media/:mediaId', () => {
  it('removes media from series', async () => {
    const fixtures = await loadFixtures(['seriesWithLinkedMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app).delete(`/v1/media/series/${series.id}/media/${media.id}`);

    expect(res.status).toBe(204);

    const deleted = await SeriesMedia.findOneBy({ seriesId: series.id, mediaId: media.id });
    expect(deleted).toBeNull();
  });

  it('returns 404 when relation does not exist', async () => {
    const fixtures = await loadFixtures(['seriesAndMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app).delete(`/v1/media/series/${series.id}/media/${media.id}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

**Step 2: Run series tests**

```bash
bun run test -- tests/controllers/seriesController.test.ts
```
Expected: 17 tests passing.

**Step 3: Commit**

```
jj describe -m "test: migrate seriesController tests to fixture catalog"
jj new
```

---

### Task 4: Migrate userExportController.test.ts

**Files:**
- Modify: `tests/controllers/userExportController.test.ts`

Only two tests use `seedMedia()`. Replace each with `loadFixtures(['singleMedia'])`. The rest of the file is unchanged.

**Step 1: Update imports** — remove `seedMedia` import, add `loadFixtures`:

```typescript
import { loadFixtures } from '../fixtures/loader';
```

**Step 2: Update the two tests**

"includes collections with ordered segment UUIDs" — replace `const media = await seedMedia();` with:
```typescript
const mediaFixtures = await loadFixtures(['singleMedia']);
const media = mediaFixtures.media.testShow;
```

"includes reports for the user" — replace `const media = await seedMedia();` with:
```typescript
const mediaFixtures = await loadFixtures(['singleMedia']);
const media = mediaFixtures.media.testShow;
```

(Use `mediaFixtures` as the variable name to avoid shadowing the outer `fixtures` variable that holds `CoreFixtures`.)

**Step 3: Run userExport tests**

```bash
bun run test -- tests/controllers/userExportController.test.ts
```
Expected: 5 tests passing.

**Step 4: Commit**

```
jj describe -m "test: migrate userExportController tests to fixture catalog"
jj new
```

---

### Task 5: Delete media.ts, series.ts, episode.ts fixture helpers

Now that no test imports them, delete the three remaining ad-hoc seed files.

**Files:**
- Delete: `tests/fixtures/media.ts`
- Delete: `tests/fixtures/series.ts`
- Delete: `tests/fixtures/episode.ts`

**Step 1: Delete the files**

```bash
rm tests/fixtures/media.ts tests/fixtures/series.ts tests/fixtures/episode.ts
```

**Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: no errors (nothing imports these files anymore).

**Step 3: Run all controller tests**

```bash
bun run test -- tests/controllers/
```
Expected: all 51 tests passing.

**Step 4: Commit**

```
jj describe -m "test: delete media/series/episode fixture helpers — catalog is now the only test data source"
jj new
```
