# Nadeshiko Agent Guide

This file captures project conventions for code agents working in this repository.

## Workspace Rules

- Use `jj` for VCS operations. Do not use `git` commands unless explicitly asked.
- Keep controllers slim and move response shaping to mapper files.
- Prefer TypeORM ActiveRecord style (`Model.save`, `entity.save`) over repository pattern.

## Backend Controller Patterns

### 1. Listing with pagination

- Use `BaseEntity.paginate(...)` for paginated list endpoints.
- Prefer:
  - `find` for `where/order` options.
  - `take` and `skip` from validated query params.
  - `exists` only when you must distinguish:
    - "parent exists but empty list" vs
    - "parent does not exist (404)".
- Do not duplicate pagination math in controllers (`nextCursor`, `hasMore`) when `paginate` already returns it.

### 2. Create endpoints

- Prefer direct writes with `Model.save({...})`.
- Do not pre-query parent existence (`findOneOrFail`) only to guard FK constraints.
- Let DB constraints fail and map errors centrally in error middleware.

### 3. Update endpoints

- Prefer `Model.updateOrFail({ where, patch })`.
- Avoid manual `if (body.field)` assignments; they break for falsy values and duplicate boilerplate.

### 4. Delete endpoints

- If entity is soft-deletable (`@DeleteDateColumn`), use `Model.softDeleteOrFail(where)`.
- Otherwise use `Model.deleteOrFail(where)`.
- For relation/unlink endpoints (join table rows), use `deleteOrFail` so missing rows return `404`.

### 5. Response shaping (mappers)

- Controllers should return mapper output, not inline DTO construction.
- Add mapper helpers for:
  - single item DTO
  - list DTO
  - "with relations" DTO variants
- Prefer inferring optional expansions from loaded relations in mapper (`relation !== undefined`) when practical.

### 6. Include/expand handling

- Avoid string literals sprinkled across controllers (`'media.characters'`).
- Keep include tokens as exported enums (for example `MediaInclude`).
- Keep relation-building logic near the model (`Media.buildRelations(...)`), not repeated in controllers.

### 7. Auth in controllers

- Do not check `if (!req.user) throw AuthCredentialsInvalidError(...)` in controllers.
  - Auth middleware guarantees `req.user` is set before any controller runs.
  - These checks are unreachable at runtime — they are dead code.
- Use `assertUser(req)` from `@app/middleware/authentication` to narrow `req.user` from `User | undefined` to `User`.
  - It throws a plain `Error` (programming assertion, not an auth error) if somehow called without auth running.
  - Usage: `const user = assertUser(req);`
- Do **not** use `req.user!` — `assertUser` is the correct way to narrow the type.
- Do **not** test 401 unauthenticated behavior in controller tests — those belong in auth/middleware tests (see Testing Conventions).

### 8. Service objects

- Avoid introducing Rails-style "service object" layers for controller-specific flows.
- Keep logic in:
  - model methods (ActiveRecord style),
  - controller-local/private helpers,
  - mapper files for response shaping.
- Only keep standalone service modules when behavior is truly cross-cutting and reused in multiple domains.

### 9. Controller file layout

- Put controller endpoint handlers at the top of the file (entrypoints first).
- Define helper/private functions below the handlers.
- Order helpers by call flow:
  - a parent function appears before the helpers it calls,
  - callee helpers appear later in the file.

## Error Handling Conventions

- Centralize DB error mapping in `backend/app/middleware/errorHandler.ts`.
- Map by PostgreSQL error code:
  - `23503` (FK violation) -> `NOT_FOUND`
  - `23505` (unique violation) -> `DUPLICATE_KEY`
- Derive details from `driverError.constraint` / `driverError.table` patterns.
- Do not parse brittle free-form DB error messages.

## Testing Conventions

### Controller tests (`backend/tests/controllers/*`)

- Validate business behavior and DB effects:
  - success cases
  - `404` for not-found/update/delete-missing
  - FK-driven `404`
  - unique-driven `409` (`DUPLICATE_KEY`)
  - pagination behavior
- Prefer response assertions with composed objects:
  - `expect(res.body).toMatchObject({...})`
  - keep targeted checks like `toHaveLength(...)` when needed.
- Example references:
  - `backend/tests/controllers/episodeController.test.ts`
  - `backend/tests/controllers/seriesController.test.ts`

### Fixtures (`backend/tests/fixtures/*`)

- Prefer declarative prelinked fixture sets for reusable graphs:
  - define in `backend/tests/fixtures/catalog/index.ts`
  - load with `loadFixtures(['setName'])`
  - link foreign keys via `ref('entity.namedFixture.id')`
- Prefer named fixture sets for multi-record setup:
  - `seedMediaFixtures({ spyXFamily: {...}, anotherShow: {...} })`
  - `seedEpisodeFixtures(media.id, { first: {...}, second: {...} })`
  - `seedSeriesFixtures({ aSeries: {...}, bSeries: {...} })`
  - `seedSeiyuuFixtures({ saori: {...} })`
  - `seedCharacterFixtures(seiyuu, { yor: {...} })`
- Keep single-record helpers too (`seedMedia`, `seedSeries`, `seedSeiyuu`) for focused one-off setup.
- Derive seed input types from entities instead of hand-written pick-lists:
  - `type XSeedInput = Partial<EntityType>`
- Keep scenario semantics in test names/fixture keys (`spyXFamily`, `yor`, `mainSeries`) instead of generic `a`/`b` where possible.

### Auth/permission tests (separate suite)

- Do not mix full auth matrix checks into every controller test file.
- Add dedicated route/middleware tests for:
  - `401` unauthenticated
  - `403` insufficient permissions
  - `429` quota/rate-limit behavior
- Reason: `createTestApp()` in controller tests injects auth and mounts generated routes directly, so it intentionally focuses on controller behavior.

## Quick Validation Commands

- Backend typecheck: `bun run typecheck` (from `backend/`)
- Targeted tests:
  - `bun run test -- tests/controllers/episodeController.test.ts`
  - `bun run test -- tests/controllers/seriesController.test.ts`
