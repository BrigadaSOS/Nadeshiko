# Backend Testing Plan

## Philosophy

Inspired by Rails/minitest conventions:

- **Real infrastructure, not mocks** for data layers. Tests run against real Postgres and Elasticsearch to catch actual query issues, analyzer behavior, and data integrity problems. Middleware auth logic uses mocks (it's pure code branching, not data queries).
- **Convention over configuration.** Test files mirror source structure. No `unit/` vs `integration/` distinction — a search test is a search test regardless of whether it hits ES.
- **Fixtures, not factories.** A small, curated, shared dataset loaded once per suite. Rails-style: define it once, reuse everywhere.
- **Helpers over frameworks.** A thin `TestClient` with methods like `client.search({ query: "食べる" })` instead of raw supertest boilerplate.
- **Tests describe behavior.** Name tests as sentences: `"returns baseform matches for conjugated verbs"`, not `"should work"`.

## Framework

**`bun test`** — already available, zero install, Jest-compatible API.

No additional test libraries needed. Bun provides:
- `describe`, `test`, `expect` — assertions
- `mock`, `spyOn` — mocking (for middleware tests)
- `beforeAll`, `afterAll`, `beforeEach` — lifecycle hooks
- Native `fetch` — HTTP requests to the test server (no supertest needed)

## Infrastructure: Real Services, Isolated Data

### No Testcontainers Needed

The dev `docker-compose.yaml` already runs Postgres, Elasticsearch, and Sudachi. Tests reuse these services with **isolated data** (separate database + separate ES index). This mirrors how Rails uses the same Postgres with a `_test` database.

### Test Database (Postgres)

- Database name: `nadeshiko_test` (alongside the dev `nadeshiko` database)
- Created once via a setup script, migrations run via TypeORM's `runMigrations()`
- **Cleanup strategy:** Truncate all tables between test suites (fast, no migration re-run). Use a helper like `truncateAllTables()` that runs `TRUNCATE ... CASCADE` on all entity tables.
- Fixtures are inserted in `beforeAll` of each suite that needs them.

### Test Index (Elasticsearch)

- Index name: `nadedb_test` (alongside the dev `nadedb` index)
- Created with the **real** `elasticsearch-schema.json` mappings (Sudachi analyzers, romaji char filters, etc.) — this is the whole point: testing that the analyzers work correctly.
- **Cleanup strategy:** Delete and recreate the index between test suites that modify ES data. For read-only suites, create once and share.
- Fixture segments bulk-indexed in `beforeAll`.

### Setup Script

Add a `bun run test:setup` script that:

1. Creates `nadeshiko_test` Postgres database if it doesn't exist
2. Runs TypeORM migrations against it
3. Creates the `nadedb_test` ES index with real schema mappings
4. Verifies connectivity to both services

This runs once before the first test run (or as a CI step). Individual test files don't need to worry about database/index creation.

## File Structure

```
backend/
  test/
    helpers/
      setup.ts              # Boot test app (Express + real DB + real ES)
      client.ts             # TestClient class wrapping fetch
      database.ts           # DB connection, truncation, fixture loading
      elasticsearch.ts      # ES index management, bulk indexing
      auth.ts               # Auth helpers (mock auth for middleware, real API keys for integration)
    fixtures/
      media.ts              # 3-4 Media records (anime + jdrama, with all name variants)
      episodes.ts           # 2-3 episodes per media
      segments.ts           # ~30 segments with curated Japanese content (see below)
      users.ts              # Test users with different roles/permissions
      apiKeys.ts            # API keys (valid, expired, service, legacy)
    middleware/
      authentication.test.ts
      authorization.test.ts
      errorHandler.test.ts
      rateLimitQuota.test.ts
    search/
      search.test.ts         # POST /v1/search
      searchStats.test.ts    # POST /v1/search/stats
      searchMultiple.test.ts # POST /v1/search/multiple
      searchContext.test.ts  # POST /v1/search/context
      mediaInfo.test.ts      # GET /v1/search/media
    search/
      inputDetection.test.ts # detectInputScript (kanji/kana/romaji)
      scoring.test.ts        # Length scoring, boost behavior
```

## Helpers

### `test/helpers/setup.ts` — Boot the Test App

Creates a standalone Express app with the real router and middleware stack, connected to the test database and test ES index. No pg-boss, no telemetry, no workers.

```ts
// Pseudocode
export async function createTestApp(): Promise<{ app: Express; baseUrl: string }> {
  // 1. Override env for test DB + test ES index
  // 2. Initialize TypeORM with test database
  // 3. Build Express app with same middleware stack as main.ts:
  //    requestId → json parsing → httpLogger → originSafetyLimiter → router → 404 → errorHandler
  // 4. Start listening on a random port
  // 5. Return app instance + base URL
}

export async function teardownTestApp(): Promise<void> {
  // Close DB connection, stop server
}
```

### `test/helpers/client.ts` — TestClient (Rails-style)

Wraps `fetch` with auth headers and typed responses. Inspired by Rails' `ActionDispatch::IntegrationTest`:

```ts
class TestClient {
  constructor(private baseUrl: string, private apiKey?: string) {}

  // Search endpoints
  async search(body: Partial<SearchBody>): Promise<Response>
  async searchStats(body: Partial<SearchStatsBody>): Promise<Response>
  async searchMultiple(body: { words: string[] }): Promise<Response>
  async searchContext(body: Partial<ContextBody>): Promise<Response>
  async mediaInfo(query?: Record<string, string>): Promise<Response>

  // Auth helpers
  withApiKey(key: string): TestClient    // returns new client with different key
  withNoAuth(): TestClient               // returns client with no auth header

  // Assertion helpers (optional, Rails-style)
  // These read the response and assert in one step:
  // await client.search({ query: "食べる" }).expectStatus(200)
}
```

### `test/helpers/database.ts`

```ts
export async function connectTestDatabase(): Promise<DataSource>
export async function truncateAllTables(ds: DataSource): Promise<void>
export async function loadFixtures(ds: DataSource): Promise<FixtureData>
```

### `test/helpers/elasticsearch.ts`

```ts
export async function createTestIndex(client: Client): Promise<void>
export async function deleteTestIndex(client: Client): Promise<void>
export async function bulkIndexSegments(client: Client, segments: SegmentDocument[]): Promise<void>
// Calls refresh after bulk to make data immediately searchable
```

### `test/helpers/auth.ts`

For middleware tests, provides mock request/response objects:

```ts
export function mockRequest(overrides?: Partial<Request>): Request
export function mockResponse(): Response & { statusCode: number; body: any }
export function mockNext(): NextFunction & { calledWith?: Error }
```

For search integration tests, provides real API keys from fixtures:

```ts
export function getValidApiKey(): string        // key with READ_MEDIA permission
export function getAdminApiKey(): string         // key with ADD_MEDIA permission
export function getExpiredApiKey(): string       // deactivated key
export function getNoPermissionApiKey(): string  // key with no permissions
```

## Fixtures

### Segment Fixtures (~30 segments)

The segment fixtures are the most important. They must be carefully curated to cover the search edge cases:

```ts
// Categories of segments to include:

// === VERB CONJUGATION (baseform matching) ===
// "食べました" — past tense of 食べる, tests baseform analyzer
// "走っている" — te-iru form of 走る
// "飲まなかった" — negative past of 飲む

// === SCRIPT TYPES ===
// "おはようございます" — hiragana-only input
// "カタカナテスト" — katakana-only
// "漢字だけのテスト" — kanji-heavy

// === LENGTH VARIATION (for scoring tests) ===
// Short: "はい" (2 chars)
// Medium: "今日はいい天気ですね" (10 chars)
// Target length (~27 chars): "彼女は毎日図書館で日本語を勉強しています"
// Long: 50+ char sentence

// === MULTI-LANGUAGE ===
// Segments with contentEnglish: "She went to the store"
// Segments with contentSpanish: "Ella fue a la tienda"
// Segments with both

// === CONTEXT (surrounding segments) ===
// 5+ sequential segments from same media/episode with consecutive positions
// (for searchContext endpoint testing)

// === MEDIA/EPISODE FILTERING ===
// Segments spread across 2+ media, 2+ episodes each
// At least one ANIME and one JDRAMA category

// === EXACT MATCH vs FUZZY ===
// Two segments where one contains a substring of the other
// e.g., "大丈夫" and "大丈夫ですか"
```

### Media Fixtures

```ts
export const testMedia = [
  {
    id: 1,
    anilistId: 10001,
    japaneseName: "テストアニメ",
    romajiName: "Test Anime",
    englishName: "Test Anime",
    category: CategoryType.ANIME,
    // ... other required fields
  },
  {
    id: 2,
    anilistId: 10002,
    japaneseName: "テストドラマ",
    romajiName: "Test Drama",
    englishName: "Test Drama",
    category: CategoryType.JDRAMA,
  },
  {
    id: 3,
    // third media for exclusion filter tests
  },
];
```

### User/API Key Fixtures

```ts
export const testUsers = [
  { id: 1, isActive: true, monthlyQuotaLimit: 1000 },   // normal user
  { id: 2, isActive: false },                             // inactive user
];

export const testApiKeys = {
  valid: "nade_test_valid_key_read",          // READ_MEDIA permission, user 1
  admin: "nade_test_admin_key",               // ADD_MEDIA permission, user 1
  noPerms: "nade_test_no_perms",              // no permissions, user 1
  expired: "nade_test_expired_key",           // disabled key
  legacy: "legacy_test_key_abc123",           // non-nade_ prefix, in api_auth table
  service: "nade_test_service_key",           // service key (bypasses quota)
};
```

## Test Specifications

### 1. Middleware Tests

These mock the DB/auth layer — they test the **branching logic**, not data access.

#### `test/middleware/authentication.test.ts`

```
requireApiKeyAuth
  ✓ rejects request with no Authorization header (401, AUTH_CREDENTIALS_REQUIRED)
  ✓ rejects request with empty Bearer token (401)
  ✓ rejects request with non-Bearer Authorization (401)
  ✓ routes nade_ prefixed keys to Better Auth verification
  ✓ routes non-prefixed keys to legacy auth
  ✓ rejects key when Better Auth returns invalid (401)
  ✓ rejects key when Better Auth returns KEY_DISABLED (401, EXPIRED message)
  ✓ rejects key when Better Auth returns RATE_LIMITED (429)
  ✓ rejects key when Better Auth returns USAGE_EXCEEDED (429, QUOTA message)
  ✓ rejects key for inactive user (401)
  ✓ attaches user and auth payload to request on success
  ✓ identifies service keys by SERVICE_API_KEY_IDS env
  ✓ identifies service keys by metadata.keyType
  ✓ flattens Better Auth permissions correctly

requireSessionAuth
  ✓ rejects request with no session token (401)
  ✓ rejects session with invalid user ID (401)
  ✓ rejects session for inactive user (401)
  ✓ attaches user to request on valid session

extractBearerToken (internal, but testable)
  ✓ returns undefined for missing header
  ✓ returns undefined for non-Bearer header
  ✓ returns undefined for "Bearer " with no token
  ✓ returns trimmed token for valid header
```

#### `test/middleware/authorization.test.ts`

```
requirePermissions
  ✓ calls next() when user has all required permissions
  ✓ calls next() when user has superset of required permissions
  ✓ throws InsufficientPermissionsError when missing one permission
  ✓ throws InsufficientPermissionsError when missing multiple permissions
  ✓ lists all missing permissions in error message
  ✓ works with empty required permissions (allows all)
  ✓ handles missing auth.apiKey.permissions gracefully (treats as empty)
```

#### `test/middleware/errorHandler.test.ts`

```
handleErrors
  ✓ converts EntityNotFoundError to 404 with entity-specific message
  ✓ converts QueryFailedError with code 23505 to 409
  ✓ converts generic QueryFailedError to 500
  ✓ converts ExpressRuntimeError (request_validation) to 400 with field details
  ✓ converts ExpressRuntimeError (request_handler + ApiError) preserving error
  ✓ converts ExpressRuntimeError (request_handler + EntityNotFoundError) to 404
  ✓ converts ExpressRuntimeError (response_validation) to 500
  ✓ passes through ApiError with correct status code
  ✓ converts unknown errors to 500 InternalServerError
  ✓ attaches requestId to all error responses
  ✓ skips handling when headers already sent
  ✓ Zod validation errors include field-level detail
```

#### `test/middleware/rateLimitQuota.test.ts`

```
rateLimitApiQuota
  ✓ skips quota check for session auth
  ✓ skips quota check for service API keys
  ✓ allows request when under quota
  ✓ rejects request when quota exceeded (429)
  ✓ increments quota usage on successful response (2xx)
  ✓ does not increment quota on error response (4xx, 5xx)
```

### 2. Search Tests (Real ES)

These boot the full test app and hit real Elasticsearch. Fixtures are loaded in `beforeAll`.

#### `test/search/search.test.ts`

```
POST /v1/search
  Authentication & Authorization
    ✓ rejects request without API key (401)
    ✓ rejects request without READ_MEDIA permission (403)
    ✓ accepts request with valid READ_MEDIA key (200)

  Japanese Text Search
    ✓ finds segments by exact kanji match ("食べました")
    ✓ finds conjugated forms via baseform ("食べる" matches "食べました")
    ✓ finds segments by hiragana input ("たべる")
    ✓ finds segments by romaji input ("taberu") via kana analyzer
    ✓ kanji input does NOT search kana field (avoids homophone noise)
    ✓ romaji input boosts English/Spanish fields higher than Japanese

  Filtering
    ✓ filters by media ID (media filter)
    ✓ filters by single anime ID (animeId)
    ✓ filters by episode number array
    ✓ filters by category ("ANIME" only, "JDRAMA" only)
    ✓ filters by segment status
    ✓ excludes segments by anime ID (excludedAnimeIds)
    ✓ filters by minLength
    ✓ filters by maxLength
    ✓ combines multiple filters (category + media + length range)

  Exact Match Mode
    ✓ exactMatch: true returns only exact content matches
    ✓ exactMatch: false returns fuzzy/partial matches

  Pagination (cursor-based)
    ✓ returns results up to limit
    ✓ returns cursor for next page when more results exist
    ✓ cursor-based pagination returns correct next page
    ✓ returns no cursor when all results fit in one page

  Sorting
    ✓ contentSort: "shortest" returns shortest segments first
    ✓ contentSort: "longest" returns longest segments first
    ✓ contentSort: "none" uses relevance scoring (default length-biased)

  Scoring
    ✓ medium-length segments (~27 chars) score higher than very short/long ones
    ✓ text relevance dominates over length scoring for text queries

  UUID Lookup
    ✓ uuid parameter returns the specific segment

  Edge Cases
    ✓ empty query with no filters returns match_all results
    ✓ query with no results returns empty array
    ✓ invalid cursor returns error (400)
```

#### `test/search/searchStats.test.ts`

```
POST /v1/search/stats
  ✓ returns media statistics grouped by anime
  ✓ returns category statistics (anime vs jdrama counts)
  ✓ respects category filter
  ✓ respects exactMatch mode
  ✓ respects minLength/maxLength filters
  ✓ respects excludedAnimeIds filter
  ✓ caches results for identical queries
```

#### `test/search/searchMultiple.test.ts`

```
POST /v1/search/multiple
  ✓ returns match counts for each word
  ✓ returns media breakdown per word
  ✓ handles words with zero matches
  ✓ respects exactMatch parameter
  ✓ handles empty words array
```

#### `test/search/searchContext.test.ts`

```
POST /v1/search/context
  ✓ returns surrounding segments for given position
  ✓ defaults to limit=5 when not specified
  ✓ respects custom limit
  ✓ returns fewer segments when near start/end of episode
  ✓ filters by mediaId and episode
  ✓ returns segments in position order
```

#### `test/search/mediaInfo.test.ts`

```
GET /v1/search/media
  ✓ returns paginated media list
  ✓ respects size parameter
  ✓ respects cursor for pagination
  ✓ returns hasMoreResults: false on last page
  ✓ filters by type=anime
  ✓ filters by type=liveaction (maps to JDRAMA)
  ✓ searches by query across english/japanese/romaji names
  ✓ returns correct stats (totalAnimes, totalSegments)
  ✓ maps Media entity to correct response shape (cover, banner, folderMediaName)
```

## Implementation Order

### Phase 1: Infrastructure (do first)

1. **`test/helpers/database.ts`** — Test DB connection, migrations, truncation
2. **`test/helpers/elasticsearch.ts`** — Test index creation, bulk indexing, cleanup
3. **`test/helpers/setup.ts`** — `createTestApp()` that wires Express with real DB + ES
4. **`test/helpers/client.ts`** — `TestClient` class
5. **`test/helpers/auth.ts`** — Mock request/response builders for middleware tests
6. **Fixture files** — Media, episodes, segments, users, API keys
7. **`package.json`** — Add `test`, `test:setup`, `test:watch` scripts
8. **Environment** — `.env.test` file with test DB name and test ES index

### Phase 2: Middleware Tests

9. **`authentication.test.ts`** — Mock-based, no infra needed
10. **`authorization.test.ts`** — Pure logic, simplest test file
11. **`errorHandler.test.ts`** — Mock Express req/res
12. **`rateLimitQuota.test.ts`** — Mock quota lookups

### Phase 3: Search Integration Tests

13. **`search.test.ts`** — The big one: Japanese search accuracy, filters, pagination
14. **`searchContext.test.ts`** — Surrounding segments
15. **`searchStats.test.ts`** — Aggregations
16. **`searchMultiple.test.ts`** — Multi-word matching
17. **`mediaInfo.test.ts`** — Postgres queries, pagination math

## Configuration

### `.env.test`

```env
ENVIRONMENT=test
PORT=0
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=nadeshiko
POSTGRES_PASSWORD=nadeshiko
POSTGRES_DB=nadeshiko_test
ELASTICSEARCH_HOST=http://localhost:9200
ELASTICSEARCH_USER=elastic
ELASTICSEARCH_PASSWORD=<admin-password>
ELASTICSEARCH_INDEX=nadedb_test
UUID_NAMESPACE=<any-valid-uuid>
R2_BASE_URL=https://test.example.com
BASE_URL=http://localhost:3000
BETTER_AUTH_SECRET=test-secret-key-for-testing
```

### `package.json` scripts

```json
{
  "test": "bun test",
  "test:setup": "bun run test/helpers/setupTestDb.ts",
  "test:watch": "bun test --watch"
}
```

### `bunfig.toml` (test config)

```toml
[test]
preload = ["./test/helpers/preload.ts"]
```

The preload script loads `.env.test` environment variables before any test file runs.

## Key Design Decisions

### Why no testcontainers?

Docker-compose already runs Postgres + ES during development. Adding testcontainers means:
- Another dependency
- Slower startup (container boot time)
- Duplicated infrastructure definition

Instead, we use the **same services** with isolated data (separate DB name + ES index). This is how Rails works — same Postgres, different database.

For CI, the GitHub Actions workflow would start Postgres + ES as services (same docker-compose or GH Actions service containers).

### Why not mock ES for search tests?

The Elasticsearch service (`elasticsearch.ts`) builds complex query DSL with:
- Sudachi tokenizer behavior (baseform, normalized, kana readings)
- Input script detection affecting field selection
- Gauss decay scoring functions
- `query_string` with operators
- Cursor-based pagination via `search_after`

Mocking `client.search()` would only verify you're building *some* JSON — it wouldn't catch:
- A Sudachi analyzer producing unexpected tokens for edge-case input
- The `gauss` decay parameters producing wrong sort order
- `query_string` syntax errors that ES rejects
- Cursor values that aren't valid for subsequent requests
- Romaji char filter mappings not matching correctly

The whole value of the search is correctness. Test it for real.

### Why mock auth middleware but not search?

Auth middleware is **branching logic**: "if key starts with `nade_`, go path A, else path B". The correctness depends on code paths, not on what the database returns. A mock that returns `{ isActive: true }` or `{ isActive: false }` covers all branches.

Search is **data transformation**: Japanese text → tokenized → scored → ranked → paginated. The correctness depends on the full pipeline including external systems (ES analyzers). You can't meaningfully test this without the real pipeline.

### Cleanup between tests

- **Postgres:** `TRUNCATE` all tables with `CASCADE` between suites. Fast (~10ms), resets all data.
- **Elasticsearch:** Delete + recreate index between suites that write to ES. For read-only search suites, create once in `beforeAll` and share.
- **Between individual tests within a suite:** Usually no cleanup needed if tests are read-only (most search tests are). Only add `beforeEach` cleanup if a specific test mutates data.
