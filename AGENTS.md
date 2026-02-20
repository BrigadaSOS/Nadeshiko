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
- Example references:
  - `backend/tests/controllers/episodeController.test.ts`
  - `backend/tests/controllers/seriesController.test.ts`

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
