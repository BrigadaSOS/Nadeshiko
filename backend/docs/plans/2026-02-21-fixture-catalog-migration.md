# Fixture Catalog Migration + Character Controller Tests

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the migration to the Rails/fizzy-style fixture catalog, removing all inline `seedXFixtures({...})` multi-record calls from tests and unused seed helpers, then add `characterController.test.ts`.

**Architecture:** The catalog (`tests/fixtures/catalog/index.ts`) is the single source of truth for named fixture scenarios. Tests load scenarios with `loadFixtures(['setName'])`. Single-entity helpers (`seedMedia`, `seedSeries`, `seedEpisode`) are kept for one-off setup but their multi-record `seedXFixtures` variants are removed. `Seiyuu`/`Character` require explicit IDs in the catalog because they use `@PrimaryColumn` (no auto-increment).

**Tech Stack:** Bun, Vitest, TypeORM, supertest. All tests in `backend/tests/controllers/`. Run tests with `bun run test -- tests/controllers/<file>` from `backend/`.

---

### Task 1: Add five new fixture sets to the catalog

**Files:**
- Modify: `tests/fixtures/catalog/index.ts`

The catalog currently has: `core`, `seiyuuWithRoles`, `seriesWithOrderedMedia`, `mediaWithTwoEpisodes`, `mediaWithThreeEpisodes`.

Add these five sets at the end of `FIXTURE_SETS` (before the closing `} satisfies ...`):

**`seiyuuNoCharacters`** — a seiyuu with no characters, for the "empty response" case in seiyuu tests. Seiyuu uses `@PrimaryColumn` so the id must be explicit; use 3001 to avoid colliding with seiyuuWithRoles (2001).

**`characterNoAppearances`** — a seiyuu + one character with no media appearances, for the character controller "empty" test.

**`twoSeriesAlphabetical`**, **`twoSeriesForSearch`**, **`threeSeriesForPagination`** — replace the three inline `seedSeriesFixtures` blocks in seriesController tests. Series uses `@PrimaryColumn({ generated: 'increment' })` so no explicit id needed.

**Step 1: Add the five fixture sets**

In `tests/fixtures/catalog/index.ts`, add after the `mediaWithThreeEpisodes` entry and before the closing `} satisfies`:

```typescript
  seiyuuNoCharacters: {
    seiyuu: {
      kana: {
        id: 3001,
        nameJapanese: '花澤香菜',
        nameEnglish: 'Kana Hanazawa',
        imageUrl: 'https://example.com/kana.jpg',
      },
    },
  },
  characterNoAppearances: {
    seiyuu: {
      kana: {
        id: 3001,
        nameJapanese: '花澤香菜',
        nameEnglish: 'Kana Hanazawa',
        imageUrl: 'https://example.com/kana.jpg',
      },
    },
    characters: {
      alice: {
        id: 3001,
        nameJapanese: 'アリス',
        nameEnglish: 'Alice',
        imageUrl: 'https://example.com/alice.jpg',
        seiyuu: ref('seiyuu.kana'),
      },
    },
  },
  twoSeriesAlphabetical: {
    series: {
      bSeries: { nameJa: 'B', nameRomaji: 'B', nameEn: 'B Series' },
      aSeries: { nameJa: 'A', nameRomaji: 'A', nameEn: 'A Series' },
    },
  },
  twoSeriesForSearch: {
    series: {
      naruto: { nameJa: 'ナルト', nameRomaji: 'Naruto', nameEn: 'Naruto' },
      bleach: { nameJa: 'ブリーチ', nameRomaji: 'Bleach', nameEn: 'Bleach' },
    },
  },
  threeSeriesForPagination: {
    series: {
      aSeries: { nameJa: 'A', nameRomaji: 'A', nameEn: 'A' },
      bSeries: { nameJa: 'B', nameRomaji: 'B', nameEn: 'B' },
      cSeries: { nameJa: 'C', nameRomaji: 'C', nameEn: 'C' },
    },
  },
```

**Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: no errors (the new entries satisfy the `FixtureCatalog` type).

**Step 3: Commit**

```
jj describe -m "test: add catalog fixture sets for seiyuu/character/series scenarios"
jj new
```

---

### Task 2: Migrate seiyuuController.test.ts to use catalog

**Files:**
- Modify: `tests/controllers/seiyuuController.test.ts`

Currently the "empty" test does:
```typescript
import { seedSeiyuu, resetSeiyuuFixtureIds } from '../fixtures/seiyuu';
// ...
beforeEach(async () => {
  await seedCoreFixtures(app);
  resetSeiyuuFixtureIds();
});
// ...
it('returns empty characters when seiyuu has no media appearances', async () => {
  const seiyuu = await seedSeiyuu();
  const res = await request(app).get(`/v1/media/seiyuu/${seiyuu.id}`);
  expect(res.body).toMatchObject({ id: seiyuu.id, characters: [] });
});
```

Replace with the catalog approach:

**Step 1: Rewrite seiyuuController.test.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestSuite, createTestApp } from '../helpers/setup';
import { seedCoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';

setupTestSuite();

const app = createTestApp();

beforeEach(async () => {
  await seedCoreFixtures(app);
});

describe('GET /v1/media/seiyuu/:id', () => {
  it('returns seiyuu with flattened character media roles', async () => {
    const fixtures = await loadFixtures(['seiyuuWithRoles']);
    const saori = fixtures.seiyuu.saori;
    const yor = fixtures.characters.yor;
    const spyXFamily = fixtures.media.spyXFamily;
    const anotherShow = fixtures.media.anotherShow;

    const res = await request(app).get(`/v1/media/seiyuu/${saori.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: saori.id,
      nameJa: '早見沙織',
      nameEn: 'Saori Hayami',
    });
    expect(res.body.characters).toHaveLength(2);
    expect(res.body.characters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: yor.id,
          nameJa: 'ヨル',
          nameEn: 'Yor',
          role: 'MAIN',
          media: expect.objectContaining({ id: spyXFamily.id }),
        }),
        expect.objectContaining({
          id: yor.id,
          nameJa: 'ヨル',
          nameEn: 'Yor',
          role: 'SUPPORTING',
          media: expect.objectContaining({ id: anotherShow.id }),
        }),
      ]),
    );
  });

  it('returns empty characters when seiyuu has no characters', async () => {
    const fixtures = await loadFixtures(['seiyuuNoCharacters']);
    const kana = fixtures.seiyuu.kana;

    const res = await request(app).get(`/v1/media/seiyuu/${kana.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: kana.id,
      characters: [],
    });
  });

  it('returns 404 when seiyuu does not exist', async () => {
    const res = await request(app).get('/v1/media/seiyuu/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

**Step 2: Run the seiyuu tests**

```bash
bun run test -- tests/controllers/seiyuuController.test.ts
```
Expected: 3 passing tests, `resetSeiyuuFixtureIds` no longer imported.

**Step 3: Commit**

```
jj describe -m "test: migrate seiyuuController tests to fixture catalog"
jj new
```

---

### Task 3: Migrate seriesController.test.ts to use catalog

**Files:**
- Modify: `tests/controllers/seriesController.test.ts`

The three GET `/v1/media/series` tests currently use `seedSeriesFixtures({...})` inline. Replace each with `loadFixtures`.

**Step 1: Update imports** — remove `seedSeriesFixtures` import (keep `seedSeries`):

```typescript
import { seedSeries } from '../fixtures/series';
import { loadFixtures } from '../fixtures/loader';
```

**Step 2: Replace the three inline seedSeriesFixtures calls**

"returns paginated series sorted by name":
```typescript
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
```

"filters by query string":
```typescript
it('filters by query string', async () => {
  await loadFixtures(['twoSeriesForSearch']);

  const res = await request(app).get('/v1/media/series?query=naru');

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    series: [{ nameEn: 'Naruto' }],
  });
  expect(res.body.series).toHaveLength(1);
});
```

"supports cursor pagination":
```typescript
it('supports cursor pagination', async () => {
  await loadFixtures(['threeSeriesForPagination']);

  const res = await request(app).get('/v1/media/series?limit=2&cursor=0');

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    pagination: { hasMore: true, cursor: 2 },
  });
  expect(res.body.series).toHaveLength(2);
});
```

**Step 3: Run the series tests**

```bash
bun run test -- tests/controllers/seriesController.test.ts
```
Expected: all tests passing.

**Step 4: Commit**

```
jj describe -m "test: migrate seriesController tests to fixture catalog"
jj new
```

---

### Task 4: Write characterController.test.ts

**Files:**
- Create: `tests/controllers/characterController.test.ts`

The endpoint is `GET /v1/media/characters/:id`. The response shape (from `toCharacterWithMediaDTO`):
```json
{
  "id": 2001,
  "nameJa": "ヨル",
  "nameEn": "Yor",
  "imageUrl": "...",
  "seiyuu": { "id": 2001, "nameJa": "早見沙織", "nameEn": "Saori Hayami", "imageUrl": "..." },
  "mediaAppearances": [
    { "role": "MAIN", "media": { "id": ..., "nameEn": "Spy x Family", ... } },
    { "role": "SUPPORTING", "media": { "id": ..., "nameEn": "Another Show", ... } }
  ]
}
```

Reuse `seiyuuWithRoles` (yor has 2 appearances) for the rich case. Use `characterNoAppearances` for the empty case.

**Step 1: Create the test file**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestSuite, createTestApp } from '../helpers/setup';
import { seedCoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';

setupTestSuite();

const app = createTestApp();

beforeEach(async () => {
  await seedCoreFixtures(app);
});

describe('GET /v1/media/characters/:id', () => {
  it('returns character with seiyuu and media appearances', async () => {
    const fixtures = await loadFixtures(['seiyuuWithRoles']);
    const yor = fixtures.characters.yor;
    const saori = fixtures.seiyuu.saori;
    const spyXFamily = fixtures.media.spyXFamily;
    const anotherShow = fixtures.media.anotherShow;

    const res = await request(app).get(`/v1/media/characters/${yor.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: yor.id,
      nameJa: 'ヨル',
      nameEn: 'Yor',
      seiyuu: expect.objectContaining({
        id: saori.id,
        nameJa: '早見沙織',
        nameEn: 'Saori Hayami',
      }),
    });
    expect(res.body.mediaAppearances).toHaveLength(2);
    expect(res.body.mediaAppearances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'MAIN',
          media: expect.objectContaining({ id: spyXFamily.id }),
        }),
        expect.objectContaining({
          role: 'SUPPORTING',
          media: expect.objectContaining({ id: anotherShow.id }),
        }),
      ]),
    );
  });

  it('returns empty mediaAppearances when character has none', async () => {
    const fixtures = await loadFixtures(['characterNoAppearances']);
    const alice = fixtures.characters.alice;

    const res = await request(app).get(`/v1/media/characters/${alice.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: alice.id,
      mediaAppearances: [],
    });
  });

  it('returns 404 when character does not exist', async () => {
    const res = await request(app).get('/v1/media/characters/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

**Step 2: Run the character tests**

```bash
bun run test -- tests/controllers/characterController.test.ts
```
Expected: 3 passing tests.

**Step 3: Commit**

```
jj describe -m "test: add characterController tests"
jj new
```

---

### Task 5: Remove unused seed helpers

Now that all tests use the catalog, the multi-record `seedXFixtures` variants and the entire `seiyuu.ts` fixture file are dead code. Remove them.

**Files:**
- Delete: `tests/fixtures/seiyuu.ts`
- Delete: `tests/fixtures/named.ts`
- Modify: `tests/fixtures/series.ts` — remove `seedSeriesFixtures` and its `seedNamedFixtures` import
- Modify: `tests/fixtures/media.ts` — remove `seedMediaFixtures` and its `seedNamedFixtures` import
- Modify: `tests/fixtures/episode.ts` — remove `seedEpisodeFixtures` and its `seedNamedFixtures` import
- Modify: `tests/fixtures/users.ts` — remove `seedTestUser` and `seedUserFixtures` (keep `UserFixtures` interface)

**Step 1: Delete seiyuu.ts and named.ts**

```bash
rm tests/fixtures/seiyuu.ts tests/fixtures/named.ts
```

**Step 2: Rewrite series.ts** (keep only `seedSeries`):

```typescript
import { Series } from '@app/models/Series';
import type { SeedInput } from './types';

type SeriesSeedInput = SeedInput<Series>;

export async function seedSeries(overrides: SeriesSeedInput = {}): Promise<Series> {
  const series = new Series();
  Object.assign(series, {
    nameJa: 'シリーズ',
    nameRomaji: 'Shirizu',
    nameEn: 'Test Series',
    ...overrides,
  });
  await series.save();
  return series;
}
```

**Step 3: Rewrite media.ts** (keep only `seedMedia`):

```typescript
import { Media, CategoryType } from '@app/models/Media';
import type { SeedInput } from './types';

type MediaSeedInput = SeedInput<Media>;

export async function seedMedia(overrides: MediaSeedInput = {}): Promise<Media> {
  const media = new Media();
  Object.assign(media, {
    nameJa: 'テストアニメ',
    nameRomaji: 'Test Anime',
    nameEn: 'Test Anime',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Action'],
    startDate: '2024-01-01',
    studio: 'Test Studio',
    seasonName: 'WINTER',
    seasonYear: 2024,
    category: CategoryType.ANIME,
    segmentCount: 0,
    version: '1.0',
    storageBasePath: '/test',
    ...overrides,
  });
  await media.save();
  return media;
}
```

**Step 4: Rewrite episode.ts** (keep only `seedEpisode`):

```typescript
import { Episode } from '@app/models/Episode';
import type { SeedInput } from './types';

type EpisodeSeedInput = SeedInput<Episode>;

export async function seedEpisode(mediaId: number, overrides: EpisodeSeedInput = {}): Promise<Episode> {
  const episode = new Episode();
  Object.assign(episode, {
    mediaId,
    episodeNumber: 1,
    titleEn: 'Pilot',
    segmentCount: 0,
    ...overrides,
  });
  await episode.save();
  return episode;
}
```

**Step 5: Rewrite users.ts** (keep only `UserFixtures` interface):

```typescript
import type { User } from '@app/models/User';

export interface UserFixtures {
  kevin: User;
  david: User;
  jz: User;
  mike: User;
}
```

**Step 6: Typecheck**

```bash
bun run typecheck
```
Expected: no errors.

**Step 7: Run all controller tests**

```bash
bun run test -- tests/controllers/
```
Expected: all tests passing.

**Step 8: Commit**

```
jj describe -m "test: remove unused seedXFixtures helpers and seiyuu/named fixture files"
jj new
```
