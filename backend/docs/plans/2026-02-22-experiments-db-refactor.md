# Experiments DB Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded in-memory `LAB_FEATURES`/`FEATURE_FLAGS` arrays with a DB-backed `Experiment` table, rename `LabUserEnrollment` → `ExperimentEnrollment`, and unify all feature-active checks behind a single `isExperimentActive(user, key)` function with a 5-minute TTL cache.

**Architecture:** Each row in `Experiment` is a named experiment — `enforced: false` means a user-controllable lab (opt-in, shown in UI, inactive by default), `enforced: true` means a forced feature flag (auto-active by rollout, hidden from UI). `ExperimentEnrollment` tracks per-user opt-ins for non-enforced experiments only. A module-level in-memory cache with 5-minute TTL loads all `Experiment` rows at once to avoid a DB hit on every request.

**Tech Stack:** TypeORM (entities, migrations), PostgreSQL (JSONB for `allowedUserIds`), Vitest + supertest (integration tests), Bun runtime.

**Version control:** use `jj` (Jujutsu), not git.

---

## Context for implementer

The repo is a monorepo. Backend lives in `backend/`. All paths below are relative to `backend/`.

**Current state:**
- `app/config/labFeatures.ts` — exports `LAB_FEATURES: LabFeatureDefinition[]`, `FEATURE_FLAGS: FeatureFlagDefinition[]` (both currently empty arrays), and helper functions that read from these static maps.
- `app/models/LabUserEnrollment.ts` — TypeORM entity, row presence = user opted in to a lab. Fields: `id`, `userId`, `featureKey`, `enrolledAt`.
- `app/models/User.ts` — has `@OneToMany('LabUserEnrollment', 'user') labEnrollments?: LabUserEnrollment[]`
- `app/middleware/authentication.ts` — loads user with `relations: ['labEnrollments']`; result is cached for 5 min
- `app/controllers/labsController.ts` — reads from `LAB_FEATURES`/`FEATURE_FLAGS` arrays
- `tests/controllers/labsController.test.ts` — pushes to arrays in tests, clears in `afterEach`
- `tests/helpers/setup.ts` — `ensureTestSchemaCompatibility()` creates `LabUserEnrollment` table

**After this refactor:**
- `app/models/Experiment.ts` — new entity (one row per experiment definition)
- `app/models/ExperimentEnrollment.ts` — renamed from `LabUserEnrollment`, `featureKey` → `experimentKey`
- `app/config/labFeatures.ts` — rewritten: DB-backed cache, `isExperimentActive(user, key)`, `isUserEligibleForExperiment(user, key)`, `getExperimentsForUser(user)`, `invalidateExperimentCache()` (for tests)
- No OpenAPI schema changes — the API response shape (`key`, `active`, `userControllable`, `name`, `description`, `userOptedIn`) is unchanged. `userControllable` = `!experiment.enforced` in the mapping.

**Test runner:** `bun run test tests/controllers/labsController.test.ts`
**All tests:** `bun run test`

---

## Task 1: `Experiment` entity

**Files:**
- Create: `app/models/Experiment.ts`

**Step 1: Create the entity file**

```typescript
// app/models/Experiment.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('Experiment')
export class Experiment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar', unique: true })
  key!: string;

  @Column({ type: 'varchar', nullable: true })
  name?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'boolean', default: false })
  enforced!: boolean;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'rollout_percentage', type: 'int', default: 0 })
  rolloutPercentage!: number;

  @Column({ name: 'allowed_user_ids', type: 'jsonb', default: '[]' })
  allowedUserIds!: number[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
```

**Step 2: Commit**

```bash
jj describe -m "feat: add Experiment entity"
jj new
```

---

## Task 2: `ExperimentEnrollment` entity

Rename `LabUserEnrollment` → `ExperimentEnrollment`, rename `featureKey` → `experimentKey`, update table/column names and relation.

**Files:**
- Create: `app/models/ExperimentEnrollment.ts`
- Delete: `app/models/LabUserEnrollment.ts` (contents replaced by the new file)

**Step 1: Create `ExperimentEnrollment.ts`**

```typescript
// app/models/ExperimentEnrollment.ts
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index, CreateDateColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';

@Entity('ExperimentEnrollment')
@Index(['userId', 'experimentKey'], { unique: true })
export class ExperimentEnrollment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'experiment_key', type: 'varchar' })
  experimentKey!: string;

  @CreateDateColumn({ name: 'enrolled_at' })
  enrolledAt!: Date;

  @ManyToOne('User', 'experimentEnrollments', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
```

**Step 2: Delete the old file**

```bash
rm app/models/LabUserEnrollment.ts
```

**Step 3: Commit**

```bash
jj describe -m "feat: add ExperimentEnrollment entity, remove LabUserEnrollment"
jj new
```

---

## Task 3: Update User model, models index, and database config

Rename the `labEnrollments` relation to `experimentEnrollments` and update all the registration files.

**Files:**
- Modify: `app/models/User.ts`
- Modify: `app/models/index.ts`
- Modify: `config/database.ts`

**Step 1: Update `app/models/User.ts`**

Change import and relation:
```typescript
// Remove:
import type { LabUserEnrollment } from './LabUserEnrollment';
// Add:
import type { ExperimentEnrollment } from './ExperimentEnrollment';

// Remove:
@OneToMany('LabUserEnrollment', 'user')
labEnrollments?: LabUserEnrollment[];
// Add:
@OneToMany('ExperimentEnrollment', 'user')
experimentEnrollments?: ExperimentEnrollment[];
```

**Step 2: Update `app/models/index.ts`**

```typescript
// Remove:
export { LabUserEnrollment } from './LabUserEnrollment';
// Add:
export { Experiment } from './Experiment';
export { ExperimentEnrollment } from './ExperimentEnrollment';
```

**Step 3: Update `config/database.ts`**

```typescript
// Remove LabUserEnrollment import, add Experiment and ExperimentEnrollment:
import {
  // ... existing imports ...
  Experiment,
  ExperimentEnrollment,
} from '@app/models';

// In entities array, replace LabUserEnrollment with:
Experiment,
ExperimentEnrollment,
```

**Step 4: Commit**

```bash
jj describe -m "feat: update User model and registrations for ExperimentEnrollment"
jj new
```

---

## Task 4: Migration

Rename `LabUserEnrollment` table to `ExperimentEnrollment`, rename `feature_key` → `experiment_key`, update the unique index, and create the new `Experiment` table.

**Files:**
- Create: `db/migrations/1740600000000-experiments-refactor.ts`

**Step 1: Write the migration**

```typescript
// db/migrations/1740600000000-experiments-refactor.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExperimentsRefactor1740600000000 implements MigrationInterface {
  name = 'ExperimentsRefactor1740600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename LabUserEnrollment → ExperimentEnrollment
    await queryRunner.query(`ALTER TABLE "LabUserEnrollment" RENAME TO "ExperimentEnrollment"`);
    await queryRunner.query(`ALTER TABLE "ExperimentEnrollment" RENAME COLUMN "feature_key" TO "experiment_key"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lab_user_enrollment_user_feature"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_experiment_enrollment_user_key"
      ON "ExperimentEnrollment" ("user_id", "experiment_key")
    `);

    // Create Experiment table
    await queryRunner.query(`
      CREATE TABLE "Experiment" (
        "id" SERIAL PRIMARY KEY,
        "key" varchar NOT NULL UNIQUE,
        "name" varchar NULL,
        "description" text NULL,
        "enforced" boolean NOT NULL DEFAULT false,
        "enabled" boolean NOT NULL DEFAULT true,
        "rollout_percentage" int NOT NULL DEFAULT 0,
        "allowed_user_ids" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "Experiment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_experiment_enrollment_user_key"`);
    await queryRunner.query(`ALTER TABLE "ExperimentEnrollment" RENAME COLUMN "experiment_key" TO "feature_key"`);
    await queryRunner.query(`ALTER TABLE "ExperimentEnrollment" RENAME TO "LabUserEnrollment"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lab_user_enrollment_user_feature"
      ON "LabUserEnrollment" ("user_id", "feature_key")
    `);
  }
}
```

**Step 2: Run migration against test DB**

```bash
POSTGRES_DB=nadeshiko_test bun run db:migrate
```

Expected: migration runs without error.

**Step 3: Commit**

```bash
jj describe -m "feat: add experiments-refactor migration"
jj new
```

---

## Task 5: Rewrite `labFeatures.ts`

Replace static arrays with DB-backed cache. Single `isExperimentActive` function covers both labs and flags.

**Files:**
- Modify: `app/config/labFeatures.ts` (full rewrite)

**Step 1: Rewrite the file**

```typescript
// app/config/labFeatures.ts
import type { User } from '@app/models/User';
import { Experiment } from '@app/models/Experiment';
import crypto from 'crypto';

// --- Cache ---

const EXPERIMENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let experimentCache: { map: Map<string, Experiment>; expiresAt: number } | null = null;

async function getExperimentMap(): Promise<Map<string, Experiment>> {
  if (experimentCache && Date.now() < experimentCache.expiresAt) {
    return experimentCache.map;
  }
  const experiments = await Experiment.find();
  const map = new Map(experiments.map((e) => [e.key, e]));
  experimentCache = { map, expiresAt: Date.now() + EXPERIMENT_CACHE_TTL_MS };
  return map;
}

/** Invalidate the experiment cache — call in tests after inserting rows. */
export function invalidateExperimentCache(): void {
  experimentCache = null;
}

// --- Rollout ---

function isInRollout(userId: number, key: string, percentage: number): boolean {
  const hash = crypto.createHash('md5').update(`${userId}:${key}`).digest();
  return hash.readUInt16BE(0) % 100 < percentage;
}

// --- Public API ---

/**
 * Is this experiment currently active for the user?
 *
 * For enforced experiments (flags): active if enabled AND (in rollout OR in allowedUserIds).
 * For non-enforced experiments (labs): active only if user explicitly enrolled.
 */
export async function isExperimentActive(user: User, key: string): Promise<boolean> {
  const map = await getExperimentMap();
  const experiment = map.get(key);
  if (!experiment || !experiment.enabled) return false;

  if (experiment.enforced) {
    return (
      experiment.allowedUserIds.includes(user.id) ||
      isInRollout(user.id, key, experiment.rolloutPercentage)
    );
  }

  return user.experimentEnrollments?.some((e) => e.experimentKey === key) ?? false;
}

/**
 * Can this user see and enroll in this lab?
 * Returns false for enforced experiments — those are never user-controllable.
 */
export async function isUserEligibleForExperiment(user: User, key: string): Promise<boolean> {
  const map = await getExperimentMap();
  const experiment = map.get(key);
  if (!experiment || !experiment.enabled || experiment.enforced) return false;

  return (
    experiment.allowedUserIds.includes(user.id) ||
    isInRollout(user.id, key, experiment.rolloutPercentage)
  );
}

/**
 * Returns all experiments the user can see (eligible labs) or that are
 * active for them (enforced flags), paired with their active state.
 * Used by the listUserLabs controller to build the API response.
 */
export async function getExperimentsForUser(
  user: User,
): Promise<Array<{ experiment: Experiment; active: boolean }>> {
  const map = await getExperimentMap();
  const results: Array<{ experiment: Experiment; active: boolean }> = [];

  for (const experiment of map.values()) {
    if (!experiment.enabled) continue;

    if (experiment.enforced) {
      const active =
        experiment.allowedUserIds.includes(user.id) ||
        isInRollout(user.id, experiment.key, experiment.rolloutPercentage);
      if (active) {
        results.push({ experiment, active: true });
      }
    } else {
      const eligible =
        experiment.allowedUserIds.includes(user.id) ||
        isInRollout(user.id, experiment.key, experiment.rolloutPercentage);
      if (eligible) {
        const active =
          user.experimentEnrollments?.some((e) => e.experimentKey === experiment.key) ?? false;
        results.push({ experiment, active });
      }
    }
  }

  return results;
}
```

**Step 2: Check for any remaining consumers of the old API**

Search for references to the old exports and verify none remain outside of files being updated in subsequent tasks:

```bash
grep -r "LAB_FEATURES\|FEATURE_FLAGS\|isLabEnabledForUser\|isFlagActiveForUser\|isFeatureActiveForUser\|isUserEligibleForLab\|labEnrollments\|featureKey\|LabUserEnrollment" app/ config/ --include="*.ts" -l
```

Expected files that still need updating: `app/controllers/labsController.ts`, `app/middleware/authentication.ts` (covered in Tasks 6–7). Any other files with these references are unexpected and must be fixed.

**Step 3: Commit**

```bash
jj describe -m "feat: rewrite labFeatures with DB-backed experiment cache"
jj new
```

---

## Task 6: Update `labsController.ts`

**Files:**
- Modify: `app/controllers/labsController.ts` (full rewrite)

**Step 1: Rewrite the controller**

```typescript
// app/controllers/labsController.ts
import type { ListUserLabs, EnrollUserLab, UnenrollUserLab } from 'generated/routes/user';
import {
  getExperimentsForUser,
  isUserEligibleForExperiment,
} from '@app/config/labFeatures';
import { ExperimentEnrollment } from '@app/models/ExperimentEnrollment';
import { NotFoundError } from '@app/errors';

export const listUserLabs: ListUserLabs = async (_params, respond, req) => {
  const user = req.user!;
  const experiments = await getExperimentsForUser(user);

  const response = experiments.map(({ experiment, active }) => ({
    key: experiment.key,
    active,
    userControllable: !experiment.enforced,
    ...(experiment.enforced
      ? {}
      : {
          name: experiment.name,
          description: experiment.description,
          userOptedIn: active,
        }),
  }));

  return respond.with200().body(response);
};

export const enrollUserLab: EnrollUserLab = async ({ params }, respond, req) => {
  const user = req.user!;

  if (!(await isUserEligibleForExperiment(user, params.key))) {
    throw new NotFoundError('Lab feature not found');
  }

  const existing = await ExperimentEnrollment.findOneBy({
    userId: user.id,
    experimentKey: params.key,
  });
  if (!existing) {
    await ExperimentEnrollment.save({ userId: user.id, experimentKey: params.key });
  }

  return respond.with204();
};

export const unenrollUserLab: UnenrollUserLab = async ({ params }, respond, req) => {
  const user = req.user!;

  const result = await ExperimentEnrollment.delete({
    userId: user.id,
    experimentKey: params.key,
  });
  if (!result.affected) {
    throw new NotFoundError('Lab enrollment not found');
  }

  return respond.with204();
};
```

**Step 2: Commit**

```bash
jj describe -m "feat: update labsController to use Experiment/ExperimentEnrollment"
jj new
```

---

## Task 7: Update `authentication.ts`

Load `experimentEnrollments` relation instead of `labEnrollments`.

**Files:**
- Modify: `app/middleware/authentication.ts:271`

**Step 1: Update the `User.findOne` call**

Find (around line 271):
```typescript
user = await User.findOne({ where: { id: userId }, relations: ['labEnrollments'] });
```

Replace with:
```typescript
user = await User.findOne({ where: { id: userId }, relations: ['experimentEnrollments'] });
```

**Step 2: Run all tests to verify no regressions**

```bash
bun run test
```

Expected: all tests pass (labs tests will fail until Task 8, but this task should not break any currently-passing tests since lab tests currently rely on the arrays — if the test DB schema is correct, entity tests should still work).

**Step 3: Commit**

```bash
jj describe -m "feat: load experimentEnrollments relation in auth middleware"
jj new
```

---

## Task 8: Update `tests/helpers/setup.ts`

Replace `LabUserEnrollment` import with `Experiment` and `ExperimentEnrollment`. Update `ensureTestSchemaCompatibility` to handle both the rename (if old table still exists) and the new `Experiment` table.

**Files:**
- Modify: `tests/helpers/setup.ts`

**Step 1: Update imports**

```typescript
// Remove:
import { ..., LabUserEnrollment } from '@app/models';
// Add Experiment and ExperimentEnrollment instead:
import { ..., Experiment, ExperimentEnrollment } from '@app/models';
```

**Step 2: Update entity list in TestDataSource**

```typescript
entities: [
  User, AccountQuotaUsage, Media, MediaExternalId, Segment, Episode,
  ApiAuth, ApiAuthPermission, Character, Seiyuu, MediaCharacter,
  Collection, CollectionSegment, Series, SeriesMedia,
  Report, ReviewCheck, ReviewCheckRun, ReviewAllowlist, UserActivity,
  Experiment, ExperimentEnrollment,   // ← replaced LabUserEnrollment
],
```

**Step 3: Update `ensureTestSchemaCompatibility`**

Replace the `LabUserEnrollment` block entirely:

```typescript
// Handle LabUserEnrollment → ExperimentEnrollment rename (idempotent)
await TestDataSource.query(`
  DO $$
  BEGIN
    IF to_regclass('"LabUserEnrollment"') IS NOT NULL
       AND to_regclass('"ExperimentEnrollment"') IS NULL THEN
      ALTER TABLE "LabUserEnrollment" RENAME TO "ExperimentEnrollment";
      ALTER TABLE "ExperimentEnrollment" RENAME COLUMN "feature_key" TO "experiment_key";
      DROP INDEX IF EXISTS "IDX_lab_user_enrollment_user_feature";
    END IF;
  END $$;
`);

await TestDataSource.query(`
  CREATE TABLE IF NOT EXISTS "ExperimentEnrollment" (
    "id" SERIAL PRIMARY KEY,
    "user_id" int NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "experiment_key" varchar NOT NULL,
    "enrolled_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp NULL
  )
`);
await TestDataSource.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS "IDX_experiment_enrollment_user_key"
  ON "ExperimentEnrollment" ("user_id", "experiment_key")
`);

await TestDataSource.query(`
  CREATE TABLE IF NOT EXISTS "Experiment" (
    "id" SERIAL PRIMARY KEY,
    "key" varchar NOT NULL UNIQUE,
    "name" varchar NULL,
    "description" text NULL,
    "enforced" boolean NOT NULL DEFAULT false,
    "enabled" boolean NOT NULL DEFAULT true,
    "rollout_percentage" int NOT NULL DEFAULT 0,
    "allowed_user_ids" jsonb NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NULL
  )
`);
```

Remove all the old `ALTER TABLE IF EXISTS "LabUserEnrollment" ADD COLUMN...` blocks — they're no longer needed.

**Step 4: Verify setup compiles**

```bash
bun run typecheck 2>&1 | head -30
```

Expected: no TypeScript errors in setup.ts.

**Step 5: Commit**

```bash
jj describe -m "feat: update test setup for Experiment/ExperimentEnrollment"
jj new
```

---

## Task 9: Rewrite `labsController.test.ts`

Replace the in-memory array push pattern with DB inserts. Tests now insert `Experiment` rows (which are rolled back after each test), and call `invalidateExperimentCache()` to ensure the cache doesn't serve stale data.

**Files:**
- Modify: `tests/controllers/labsController.test.ts` (full rewrite)

**Key differences from old tests:**
- `LAB_FEATURES.push(...)` → `await Experiment.save({ enforced: false, enabled: true, rolloutPercentage: 100, allowedUserIds: [], ...fields })`
- `FEATURE_FLAGS.push(...)` + `FEATURE_FLAGS_MAP.set(...)` → `await Experiment.save({ enforced: true, enabled: true, ...fields })`
- `afterEach(() => { LAB_FEATURES.length = 0; ... })` → `afterEach(() => { invalidateExperimentCache(); })`
- `LabUserEnrollment` → `ExperimentEnrollment`, `featureKey` → `experimentKey`
- `labEnrollments` → `experimentEnrollments` in `signInAsKevinWithEnrollments`
- Test "hides labs gated to a different role" → replace with "hides labs when user not in allowedUserIds and rollout is 0" (we dropped `requiresRole`)
- Labs with no targeting now need `rolloutPercentage: 100` to be eligible (old: no targeting = open to all)
- Enforced experiments: active if in rollout; a lab with `rolloutPercentage: 0` and no allowedUserIds = not eligible

**Step 1: Write the rewritten test file**

```typescript
import request from 'supertest';
import { describe, it, expect, afterEach, setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { invalidateExperimentCache } from '@app/config/labFeatures';
import { Experiment } from '@app/models/Experiment';
import { ExperimentEnrollment } from '@app/models/ExperimentEnrollment';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;

afterEach(() => {
  invalidateExperimentCache();
});

async function signInAsKevinWithEnrollments() {
  const user = fixtures.users.kevin;
  user.experimentEnrollments = await ExperimentEnrollment.findBy({ userId: user.id });
  signInAs(app, user);
}

// --- GET /v1/user/labs ---

describe('GET /v1/user/labs', () => {
  it('returns empty array when no experiments are defined', async () => {
    fixtures = await seedCoreFixtures(app);
    const res = await request(app).get('/v1/user/labs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns eligible lab with active: false when not enrolled', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'test-lab',
      name: 'Test Lab',
      description: 'A test lab',
      enforced: false,
      enabled: true,
      rolloutPercentage: 100,
      allowedUserIds: [],
    });

    const res = await request(app).get('/v1/user/labs');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      key: 'test-lab',
      name: 'Test Lab',
      description: 'A test lab',
      active: false,
      userControllable: true,
      userOptedIn: false,
    }]);
  });

  it('hides disabled labs', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'disabled-lab',
      name: 'Disabled',
      description: 'Disabled lab',
      enforced: false,
      enabled: false,
      rolloutPercentage: 100,
      allowedUserIds: [],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });

  it('hides labs when user is not in allowedUserIds and rollout is 0', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'restricted-lab',
      name: 'Restricted',
      description: 'Not for you',
      enforced: false,
      enabled: true,
      rolloutPercentage: 0,
      allowedUserIds: [],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });

  it('shows labs when user is in allowedUserIds (even with rollout 0)', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'allowlisted-lab',
      name: 'Allow Listed',
      description: 'Allow listed lab',
      enforced: false,
      enabled: true,
      rolloutPercentage: 0,
      allowedUserIds: [fixtures.users.kevin.id],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe('allowlisted-lab');
  });

  it('hides labs when user is NOT in allowedUserIds and rollout is 0', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'other-user-lab',
      name: 'Other',
      description: 'Other user lab',
      enforced: false,
      enabled: true,
      rolloutPercentage: 0,
      allowedUserIds: [999999],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });

  it('shows labs via rolloutPercentage 100%', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'full-rollout',
      name: 'Full Rollout',
      description: 'Rolled out to everyone',
      enforced: false,
      enabled: true,
      rolloutPercentage: 100,
      allowedUserIds: [],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toHaveLength(1);
  });

  it('shows enrolled lab as active', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'enrolled-lab',
      name: 'Enrolled Lab',
      description: 'User enrolled',
      enforced: false,
      enabled: true,
      rolloutPercentage: 100,
      allowedUserIds: [],
    });

    await ExperimentEnrollment.save({
      userId: fixtures.users.kevin.id,
      experimentKey: 'enrolled-lab',
    });

    await signInAsKevinWithEnrollments();

    const res = await request(app).get('/v1/user/labs');
    expect(res.body[0]).toMatchObject({
      key: 'enrolled-lab',
      active: true,
      userControllable: true,
      userOptedIn: true,
    });
  });

  it('includes active enforced experiments as non-controllable (no name/description)', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'test-flag',
      enforced: true,
      enabled: true,
      rolloutPercentage: 0,
      allowedUserIds: [fixtures.users.kevin.id],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([{
      key: 'test-flag',
      active: true,
      userControllable: false,
    }]);
  });

  it('excludes enforced experiments user is not in rollout for', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'inactive-flag',
      enforced: true,
      enabled: true,
      rolloutPercentage: 0,
      allowedUserIds: [999999],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });

  it('excludes disabled enforced experiments', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'disabled-flag',
      enforced: true,
      enabled: false,
      rolloutPercentage: 100,
      allowedUserIds: [],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });
});

// --- POST /v1/user/labs/:key ---

describe('POST /v1/user/labs/:key', () => {
  it('enrolls user in an eligible lab', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'enroll-lab',
      name: 'Enroll Lab',
      description: 'Enroll test',
      enforced: false,
      enabled: true,
      rolloutPercentage: 100,
      allowedUserIds: [],
    });

    const res = await request(app).post('/v1/user/labs/enroll-lab');
    expect(res.status).toBe(204);

    const enrollment = await ExperimentEnrollment.findOneBy({
      userId: fixtures.users.kevin.id,
      experimentKey: 'enroll-lab',
    });
    expect(enrollment).not.toBeNull();
  });

  it('returns 404 for non-existent experiment', async () => {
    fixtures = await seedCoreFixtures(app);
    const res = await request(app).post('/v1/user/labs/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 404 for ineligible lab (user not in allowedUserIds and rollout 0)', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'ineligible-lab',
      name: 'Ineligible',
      description: 'Not for you',
      enforced: false,
      enabled: true,
      rolloutPercentage: 0,
      allowedUserIds: [999999],
    });

    const res = await request(app).post('/v1/user/labs/ineligible-lab');
    expect(res.status).toBe(404);
  });

  it('returns 404 when trying to enroll in an enforced experiment', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'a-flag',
      enforced: true,
      enabled: true,
      rolloutPercentage: 100,
      allowedUserIds: [],
    });

    const res = await request(app).post('/v1/user/labs/a-flag');
    expect(res.status).toBe(404);
  });

  it('is idempotent — enrolling twice creates only one record', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'idempotent-lab',
      name: 'Idempotent',
      description: 'Test',
      enforced: false,
      enabled: true,
      rolloutPercentage: 100,
      allowedUserIds: [],
    });

    await request(app).post('/v1/user/labs/idempotent-lab').expect(204);
    await request(app).post('/v1/user/labs/idempotent-lab').expect(204);

    const count = await ExperimentEnrollment.countBy({
      userId: fixtures.users.kevin.id,
      experimentKey: 'idempotent-lab',
    });
    expect(count).toBe(1);
  });
});

// --- DELETE /v1/user/labs/:key ---

describe('DELETE /v1/user/labs/:key', () => {
  it('unenrolls user from a lab', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'unenroll-lab',
      name: 'Unenroll Lab',
      description: 'Unenroll test',
      enforced: false,
      enabled: true,
      rolloutPercentage: 100,
      allowedUserIds: [],
    });

    await ExperimentEnrollment.save({
      userId: fixtures.users.kevin.id,
      experimentKey: 'unenroll-lab',
    });

    const res = await request(app).delete('/v1/user/labs/unenroll-lab');
    expect(res.status).toBe(204);

    const enrollment = await ExperimentEnrollment.findOneBy({
      userId: fixtures.users.kevin.id,
      experimentKey: 'unenroll-lab',
    });
    expect(enrollment).toBeNull();
  });

  it('returns 404 when not enrolled', async () => {
    fixtures = await seedCoreFixtures(app);
    const res = await request(app).delete('/v1/user/labs/nonexistent');
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run the labs tests**

```bash
bun run test tests/controllers/labsController.test.ts
```

Expected: all tests pass.

**Step 3: Run all tests**

```bash
bun run test
```

Expected: all tests pass. No regressions.

**Step 4: Commit**

```bash
jj describe -m "test: rewrite labsController tests for DB-backed Experiment"
jj new
```

---

## Final check

Verify no stale references to old names remain:

```bash
grep -r "LAB_FEATURES\|FEATURE_FLAGS\|FEATURE_FLAGS_MAP\|LAB_FEATURES_MAP\|LabUserEnrollment\|labEnrollments\|featureKey\|isLabEnabledForUser\|isFlagActiveForUser\|isFeatureActiveForUser\|isUserEligibleForLab\|LabFeatureDefinition\|FeatureFlagDefinition" app/ config/ tests/ --include="*.ts"
```

Expected: no matches.

Then run all tests one final time:

```bash
bun run test
```

Expected: all tests pass.
