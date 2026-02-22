# Feature Flags & Labs Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the current labs system into two distinct systems — user-controllable Labs (opt-in features) and invisible Feature Flags (forced A/B rollouts) — with a new `LabUserEnrollment` table replacing the `preferences.labs` JSONB.

**Architecture:** Labs and flags share targeting logic (`allowedUserIds`, `rolloutPercentage`) but differ in user agency: labs require explicit user opt-in via a DB enrollment record, while flags are silently active. Feature definitions live in code config (`labFeatures.ts`). The auth middleware eager-loads lab enrollments alongside the User entity via a relation, cached in the existing 5-minute user cache.

**Tech Stack:** TypeORM entity + migration, Express controllers, OpenAPI schema, generated routes via `bun run generate:all`, Vitest integration tests with supertest.

---

## Key Files Reference

| File | Role |
|------|------|
| `app/config/labFeatures.ts` | Feature definitions (labs + flags), helper functions |
| `app/controllers/labsController.ts` | Labs/flags endpoints |
| `app/services/labsService.ts` | **DELETE** — no service pattern |
| `app/models/LabUserEnrollment.ts` | **NEW** — enrollment entity |
| `app/models/User.ts` | Add `@OneToMany` relation to enrollments |
| `app/models/index.ts` | Export new entity |
| `app/middleware/authentication.ts` | Load enrollments with user |
| `tests/helpers/setup.ts` | Register entity in TestDataSource |
| `db/migrations/1740300000000-lab-user-enrollments.ts` | **NEW** — migration |
| `docs/openapi/openapi.yaml` | New paths |
| `docs/openapi/paths/user/v1_user_labs.yaml` | Updated response + new POST/DELETE |
| `docs/openapi/paths/user/v1_user_labs_key.yaml` | **NEW** — enrollment endpoints |
| `docs/openapi/components/schemas/UserLabFeature.yaml` | Updated schema |
| `app/routes/router.ts` | Register new controller handlers |
| `tests/controllers/labsController.test.ts` | **NEW** — integration tests |
| `frontend/app/stores/labs.ts` | Updated for new response shape |

---

### Task 1: Create `LabUserEnrollment` Entity

**Files:**
- Create: `app/models/LabUserEnrollment.ts`
- Modify: `app/models/User.ts:76-82` — add `@OneToMany` relation
- Modify: `app/models/index.ts` — export new entity

**Step 1: Create the entity file**

```typescript
// app/models/LabUserEnrollment.ts
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, Index, CreateDateColumn, BaseEntity } from 'typeorm';
import type { User } from './User';

@Entity('LabUserEnrollment')
@Index(['userId', 'featureKey'], { unique: true })
export class LabUserEnrollment extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'feature_key', type: 'varchar' })
  featureKey!: string;

  @CreateDateColumn({ name: 'enrolled_at' })
  enrolledAt!: Date;

  @ManyToOne('User', 'labEnrollments', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
```

Note: Follows the same pattern as `SeriesMedia` — extends `BaseEntity` (from TypeORM directly, not the custom `base.entity.ts` since we don't need `updatedAt` or the static helpers).

**Step 2: Add relation to User**

In `app/models/User.ts`, add after the `accountQuotaUsages` relation (around line 81):

```typescript
@OneToMany('LabUserEnrollment', 'user')
labEnrollments?: LabUserEnrollment[];
```

Add the type import at the top:
```typescript
import type { LabUserEnrollment } from './LabUserEnrollment';
```

**Step 3: Export from index**

In `app/models/index.ts`, add to the exports:
```typescript
export { LabUserEnrollment } from './LabUserEnrollment';
```

**Step 4: Commit**

```
feat: add LabUserEnrollment entity with User relation
```

---

### Task 2: Create Database Migration

**Files:**
- Create: `db/migrations/1740300000000-lab-user-enrollments.ts`

**Step 1: Write the migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class LabUserEnrollments1740300000000 implements MigrationInterface {
  name = 'LabUserEnrollments1740300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "LabUserEnrollment" (
        "id" SERIAL PRIMARY KEY,
        "user_id" int NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "feature_key" varchar NOT NULL,
        "enrolled_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lab_user_enrollment_user_feature"
      ON "LabUserEnrollment" ("user_id", "feature_key")
    `);

    -- Migrate existing preferences.labs data
    await queryRunner.query(`
      INSERT INTO "LabUserEnrollment" ("user_id", "feature_key", "enrolled_at")
      SELECT u."id", lab.key, now()
      FROM "User" u,
           LATERAL jsonb_each_text(COALESCE(u."preferences" -> 'labs', '{}'::jsonb)) AS lab(key, value)
      WHERE lab.value = 'true'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "LabUserEnrollment"`);
  }
}
```

**Step 2: Commit**

```
feat: add lab_user_enrollments migration with data migration from preferences.labs
```

---

### Task 3: Update Auth Middleware to Load Enrollments

**Files:**
- Modify: `app/middleware/authentication.ts:271` — update `User.findOne` call
- Modify: `tests/helpers/setup.ts` — register `LabUserEnrollment` in TestDataSource entities

**Step 1: Update `attachAuthPayloadToRequest`**

In `app/middleware/authentication.ts`, change the `User.findOne` call (around line 271):

```typescript
// Before:
user = await User.findOne({ where: { id: userId } });

// After:
user = await User.findOne({ where: { id: userId }, relations: ['labEnrollments'] });
```

**Step 2: Register entity in TestDataSource**

In `tests/helpers/setup.ts`, add `LabUserEnrollment` to the import and the `entities` array:

```typescript
import { LabUserEnrollment } from '@app/models';
// ... in entities array:
entities: [
  User, AccountQuotaUsage, Media, MediaExternalId, Segment, Episode,
  ApiAuth, ApiAuthPermission, Character, Seiyuu, MediaCharacter,
  Collection, CollectionSegment, Series, SeriesMedia,
  Report, ReviewCheck, ReviewCheckRun, ReviewAllowlist, UserActivity,
  LabUserEnrollment,
],
```

**Step 3: Commit**

```
feat: eager-load lab enrollments in auth middleware and register in test datasource
```

---

### Task 4: Refactor `labFeatures.ts` — Types, Flags, and Helper Functions

**Files:**
- Modify: `app/config/labFeatures.ts` — full rewrite
- Delete: `app/services/labsService.ts`

**Step 1: Rewrite labFeatures.ts**

```typescript
import type { UserRoleType, User } from '@app/models/User';
import crypto from 'crypto';

// --- Lab features: user-visible, user-controllable, opt-in ---

export interface LabFeatureDefinition {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  requiresRole?: UserRoleType;
  allowedUserIds?: number[];
  rolloutPercentage?: number;
}

export const LAB_FEATURES: LabFeatureDefinition[] = [];

export const LAB_FEATURES_MAP = new Map(LAB_FEATURES.map((f) => [f.key, f]));

// --- Feature flags: invisible, forced, no user agency ---

export interface FeatureFlagDefinition {
  key: string;
  enabled: boolean;
  allowedUserIds?: number[];
  rolloutPercentage?: number;
}

export const FEATURE_FLAGS: FeatureFlagDefinition[] = [];

export const FEATURE_FLAGS_MAP = new Map(FEATURE_FLAGS.map((f) => [f.key, f]));

// --- Targeting helpers ---

function isUserInRollout(userId: number, featureKey: string, percentage: number): boolean {
  const hash = crypto.createHash('md5').update(`${userId}:${featureKey}`).digest();
  const value = hash.readUInt16BE(0) % 100;
  return value < percentage;
}

/** Can this user see and toggle this lab in the UI? */
export function isUserEligibleForLab(user: User, lab: LabFeatureDefinition): boolean {
  if (!lab.enabled) return false;
  if (lab.requiresRole && user.role !== lab.requiresRole) return false;

  // No targeting = open to all eligible roles
  const hasTargeting = lab.allowedUserIds || lab.rolloutPercentage !== undefined;
  if (!hasTargeting) return true;

  if (lab.allowedUserIds?.includes(user.id)) return true;
  if (lab.rolloutPercentage !== undefined && isUserInRollout(user.id, lab.key, lab.rolloutPercentage)) return true;

  return false;
}

/** Is this lab actively enabled for the user? (eligible + enrolled) */
export function isLabEnabledForUser(user: User, featureKey: string): boolean {
  const lab = LAB_FEATURES_MAP.get(featureKey);
  if (!lab) return false;
  if (!isUserEligibleForLab(user, lab)) return false;

  return user.labEnrollments?.some((e) => e.featureKey === featureKey) ?? false;
}

/** Is this feature flag active for the user? (no opt-in needed) */
export function isFlagActiveForUser(user: User, featureKey: string): boolean {
  const flag = FEATURE_FLAGS_MAP.get(featureKey);
  if (!flag || !flag.enabled) return false;

  if (flag.allowedUserIds?.includes(user.id)) return true;
  if (flag.rolloutPercentage !== undefined && isUserInRollout(user.id, flag.key, flag.rolloutPercentage)) return true;

  return false;
}

/** Check any feature (lab or flag) — convenience for gating code paths */
export function isFeatureActiveForUser(user: User, featureKey: string): boolean {
  return isLabEnabledForUser(user, featureKey) || isFlagActiveForUser(user, featureKey);
}
```

**Step 2: Delete `app/services/labsService.ts`**

**Step 3: Commit**

```
feat: refactor labFeatures.ts with labs + flags + targeting helpers, delete labsService
```

---

### Task 5: Update OpenAPI Schema and Regenerate

**Files:**
- Modify: `docs/openapi/components/schemas/UserLabFeature.yaml`
- Create: `docs/openapi/paths/user/v1_user_labs_key.yaml`
- Modify: `docs/openapi/paths/user/v1_user_labs.yaml`
- Modify: `docs/openapi/openapi.yaml`
- Regenerate: `bun run generate:all`

**Step 1: Update the UserLabFeature schema**

Replace `docs/openapi/components/schemas/UserLabFeature.yaml` with:

```yaml
type: object
required:
  - key
  - active
  - userControllable
properties:
  key:
    type: string
    description: Unique identifier for the feature
  name:
    type: string
    description: Human-readable feature name (only present for labs)
  description:
    type: string
    description: Description of what the feature does (only present for labs)
  active:
    type: boolean
    description: Whether this feature is currently active for the user
  userControllable:
    type: boolean
    description: Whether the user can toggle this feature (lab=true, flag=false)
  userOptedIn:
    type: boolean
    description: Whether the user has opted in (only present for labs)
```

**Step 2: Create the new enrollment endpoint spec**

Create `docs/openapi/paths/user/v1_user_labs_key.yaml`:

```yaml
post:
  tags:
    - User
  x-internal: true
  operationId: enrollUserLab
  summary: Enroll in a lab feature
  description: |
    Opts the authenticated user into a lab feature. The user must be eligible
    for the lab (correct role, in allowlist or rollout percentage).

    **Permissions:** Session authentication (cookie-based).
  security:
    - sessionCookie: []
  parameters:
    - name: key
      in: path
      required: true
      schema:
        type: string
      description: Lab feature key
  responses:
    "204":
      description: Enrolled successfully
    "401":
      $ref: "../../components/responses/UnauthorizedApiKey.yaml"
    "404":
      description: Lab feature not found or user not eligible
      content:
        application/json:
          schema:
            $ref: "../../components/schemas/Error404.yaml"
    "500":
      $ref: "../../components/responses/InternalServerError.yaml"

delete:
  tags:
    - User
  x-internal: true
  operationId: unenrollUserLab
  summary: Unenroll from a lab feature
  description: |
    Opts the authenticated user out of a lab feature.

    **Permissions:** Session authentication (cookie-based).
  security:
    - sessionCookie: []
  parameters:
    - name: key
      in: path
      required: true
      schema:
        type: string
      description: Lab feature key
  responses:
    "204":
      description: Unenrolled successfully
    "401":
      $ref: "../../components/responses/UnauthorizedApiKey.yaml"
    "404":
      description: Lab feature not found or user not enrolled
      content:
        application/json:
          schema:
            $ref: "../../components/schemas/Error404.yaml"
    "500":
      $ref: "../../components/responses/InternalServerError.yaml"
```

**Step 3: Add the new path to openapi.yaml**

In `docs/openapi/openapi.yaml`, add after the `/v1/user/labs` entry:

```yaml
  "/v1/user/labs/{key}":
    $ref: "paths/user/v1_user_labs_key.yaml"
```

**Step 4: Regenerate**

Run: `bun run generate:all`

Check the generated types in `generated/routes/user.ts` — it should now have `EnrollUserLab` and `UnenrollUserLab` types, and the `UserImplementation` should require `enrollUserLab` and `unenrollUserLab` handlers.

**Step 5: Commit**

```
feat: update OpenAPI schema for labs/flags response and enrollment endpoints
```

---

### Task 6: Rewrite `labsController.ts`

**Files:**
- Modify: `app/controllers/labsController.ts` — full rewrite
- Modify: `app/routes/router.ts` — register new handlers

**Step 1: Rewrite the controller**

```typescript
import type { ListUserLabs, EnrollUserLab, UnenrollUserLab } from 'generated/routes/user';
import {
  LAB_FEATURES,
  FEATURE_FLAGS,
  isUserEligibleForLab,
  isFlagActiveForUser,
} from '@app/config/labFeatures';
import { LabUserEnrollment } from '@app/models/LabUserEnrollment';
import { NotFoundError } from '@app/errors';

export const listUserLabs: ListUserLabs = async (_params, respond, req) => {
  const user = req.user!;
  const enrolledKeys = new Set(user.labEnrollments?.map((e) => e.featureKey) ?? []);

  const labs = LAB_FEATURES
    .filter((lab) => isUserEligibleForLab(user, lab))
    .map((lab) => ({
      key: lab.key,
      name: lab.name,
      description: lab.description,
      active: enrolledKeys.has(lab.key),
      userControllable: true,
      userOptedIn: enrolledKeys.has(lab.key),
    }));

  const flags = FEATURE_FLAGS
    .filter((flag) => isFlagActiveForUser(user, flag.key))
    .map((flag) => ({
      key: flag.key,
      active: true,
      userControllable: false,
    }));

  return respond.with200().body([...labs, ...flags]);
};

export const enrollUserLab: EnrollUserLab = async ({ params }, respond, req) => {
  const user = req.user!;
  const lab = LAB_FEATURES.find((f) => f.key === params.key);

  if (!lab || !isUserEligibleForLab(user, lab)) {
    throw new NotFoundError('Lab feature not found');
  }

  await LabUserEnrollment.upsert(
    { userId: user.id, featureKey: params.key },
    { conflictPaths: ['userId', 'featureKey'] },
  );

  return respond.with204();
};

export const unenrollUserLab: UnenrollUserLab = async ({ params }, respond, req) => {
  const user = req.user!;

  await LabUserEnrollment.deleteOrFail(
    { userId: user.id, featureKey: params.key },
    'Lab enrollment not found',
  );

  return respond.with204();
};
```

Note: `LabUserEnrollment` extends TypeORM's `BaseEntity` directly, not the custom one. The `deleteOrFail` static method comes from TypeORM BaseEntity — check if it exists there. If not, use a manual delete + affected check pattern instead. The upsert uses TypeORM's built-in upsert with the unique constraint.

Actually — `LabUserEnrollment` extends TypeORM's `BaseEntity` so it won't have the custom `deleteOrFail`. Use a manual pattern:

```typescript
export const unenrollUserLab: UnenrollUserLab = async ({ params }, respond, req) => {
  const user = req.user!;

  const result = await LabUserEnrollment.delete({ userId: user.id, featureKey: params.key });
  if (!result.affected) {
    throw new NotFoundError('Lab enrollment not found');
  }

  return respond.with204();
};
```

**Step 2: Register in router.ts**

In `app/routes/router.ts`, update the import:

```typescript
import { listUserLabs, enrollUserLab, unenrollUserLab } from '@app/controllers/labsController';
```

And add to the `createUserRouter` call:

```typescript
const UserRoutes = createUserRouter({
  getUserQuota,
  createUserReport,
  listUserReports,
  getUserPreferences,
  updateUserPreferences,
  listUserActivity,
  deleteUserActivity,
  getUserActivityHeatmap,
  getUserActivityStats,
  exportUserData,
  listUserLabs,
  enrollUserLab,
  unenrollUserLab,
});
```

**Step 3: Commit**

```
feat: rewrite labsController with enrollment endpoints, delete labsService
```

---

### Task 7: Remove `preferences.labs` from UserPreferences

**Files:**
- Modify: `app/models/User.ts:29-35` — remove `labs` from `UserPreferences` interface
- Modify: `docs/openapi/components/schemas/UserPreferences.yaml` — remove `labs` property if present

**Step 1: Update UserPreferences interface**

Remove the `labs?: Record<string, boolean>;` line from the `UserPreferences` interface.

**Step 2: Check and update OpenAPI UserPreferences schema**

If `docs/openapi/components/schemas/UserPreferences.yaml` has a `labs` property, remove it.

**Step 3: Regenerate**

Run: `bun run generate:all`

**Step 4: Commit**

```
refactor: remove preferences.labs from UserPreferences (now uses LabUserEnrollment table)
```

---

### Task 8: Write Integration Tests

**Files:**
- Create: `tests/controllers/labsController.test.ts`

The tests need to temporarily configure `LAB_FEATURES` and `FEATURE_FLAGS` arrays during each test. Since these are module-level arrays, tests should push items and pop them in afterEach.

**Step 1: Write the test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { LAB_FEATURES, FEATURE_FLAGS } from '@app/config/labFeatures';
import { LabUserEnrollment } from '@app/models/LabUserEnrollment';
import { UserRoleType } from '@app/models/User';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;

beforeEach(async () => {
  fixtures = await seedCoreFixtures(app);
});

afterEach(() => {
  LAB_FEATURES.length = 0;
  FEATURE_FLAGS.length = 0;
});

describe('GET /v1/user/labs', () => {
  it('returns 401 when not authenticated', async () => {
    signInAs(app, null);
    const res = await request(app).get('/v1/user/labs');
    expect(res.status).toBe(401);
  });

  it('returns empty array when no features are defined', async () => {
    const res = await request(app).get('/v1/user/labs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns lab features the user is eligible for', async () => {
    LAB_FEATURES.push({
      key: 'test-lab',
      name: 'Test Lab',
      description: 'A test lab feature',
      enabled: true,
    });

    const res = await request(app).get('/v1/user/labs');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      key: 'test-lab',
      name: 'Test Lab',
      description: 'A test lab feature',
      active: false,
      userControllable: true,
      userOptedIn: false,
    }]);
  });

  it('hides disabled labs', async () => {
    LAB_FEATURES.push({
      key: 'disabled-lab',
      name: 'Disabled',
      description: 'Disabled lab',
      enabled: false,
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });

  it('hides labs gated to a different role', async () => {
    LAB_FEATURES.push({
      key: 'patreon-lab',
      name: 'Patreon Lab',
      description: 'For patrons',
      enabled: true,
      requiresRole: UserRoleType.PATREON,
    });

    // kevin is ADMIN
    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });

  it('shows labs when user is in allowedUserIds', async () => {
    LAB_FEATURES.push({
      key: 'allow-listed-lab',
      name: 'Allow Listed',
      description: 'Allow listed lab',
      enabled: true,
      allowedUserIds: [fixtures.users.kevin.id],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe('allow-listed-lab');
  });

  it('hides labs when user is NOT in allowedUserIds', async () => {
    LAB_FEATURES.push({
      key: 'other-user-lab',
      name: 'Other',
      description: 'Other user lab',
      enabled: true,
      allowedUserIds: [999999],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });

  it('shows labs via rolloutPercentage (100%)', async () => {
    LAB_FEATURES.push({
      key: 'full-rollout',
      name: 'Full Rollout',
      description: 'Rolled out to everyone',
      enabled: true,
      rolloutPercentage: 100,
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toHaveLength(1);
  });

  it('hides labs via rolloutPercentage (0%)', async () => {
    LAB_FEATURES.push({
      key: 'no-rollout',
      name: 'No Rollout',
      description: 'Rolled out to nobody',
      enabled: true,
      rolloutPercentage: 0,
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });

  it('shows enrolled lab as active', async () => {
    LAB_FEATURES.push({
      key: 'enrolled-lab',
      name: 'Enrolled Lab',
      description: 'User enrolled',
      enabled: true,
    });

    await LabUserEnrollment.save({
      userId: fixtures.users.kevin.id,
      featureKey: 'enrolled-lab',
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body[0]).toMatchObject({
      key: 'enrolled-lab',
      active: true,
      userOptedIn: true,
    });
  });

  it('includes active feature flags as non-controllable', async () => {
    FEATURE_FLAGS.push({
      key: 'test-flag',
      enabled: true,
      allowedUserIds: [fixtures.users.kevin.id],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([{
      key: 'test-flag',
      active: true,
      userControllable: false,
    }]);
  });

  it('excludes inactive feature flags', async () => {
    FEATURE_FLAGS.push({
      key: 'inactive-flag',
      enabled: true,
      allowedUserIds: [999999],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([]);
  });
});

describe('POST /v1/user/labs/:key', () => {
  it('enrolls user in an eligible lab', async () => {
    LAB_FEATURES.push({
      key: 'enroll-lab',
      name: 'Enroll Lab',
      description: 'Enroll test',
      enabled: true,
    });

    const res = await request(app).post('/v1/user/labs/enroll-lab');
    expect(res.status).toBe(204);

    const enrollment = await LabUserEnrollment.findOneBy({
      userId: fixtures.users.kevin.id,
      featureKey: 'enroll-lab',
    });
    expect(enrollment).not.toBeNull();
  });

  it('returns 404 for non-existent lab', async () => {
    const res = await request(app).post('/v1/user/labs/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 404 for ineligible lab', async () => {
    LAB_FEATURES.push({
      key: 'ineligible-lab',
      name: 'Ineligible',
      description: 'Not for you',
      enabled: true,
      allowedUserIds: [999999],
    });

    const res = await request(app).post('/v1/user/labs/ineligible-lab');
    expect(res.status).toBe(404);
  });

  it('is idempotent (enrolling twice succeeds)', async () => {
    LAB_FEATURES.push({
      key: 'idempotent-lab',
      name: 'Idempotent',
      description: 'Test',
      enabled: true,
    });

    await request(app).post('/v1/user/labs/idempotent-lab').expect(204);
    await request(app).post('/v1/user/labs/idempotent-lab').expect(204);

    const count = await LabUserEnrollment.countBy({
      userId: fixtures.users.kevin.id,
      featureKey: 'idempotent-lab',
    });
    expect(count).toBe(1);
  });
});

describe('DELETE /v1/user/labs/:key', () => {
  it('unenrolls user from a lab', async () => {
    LAB_FEATURES.push({
      key: 'unenroll-lab',
      name: 'Unenroll Lab',
      description: 'Unenroll test',
      enabled: true,
    });

    await LabUserEnrollment.save({
      userId: fixtures.users.kevin.id,
      featureKey: 'unenroll-lab',
    });

    const res = await request(app).delete('/v1/user/labs/unenroll-lab');
    expect(res.status).toBe(204);

    const enrollment = await LabUserEnrollment.findOneBy({
      userId: fixtures.users.kevin.id,
      featureKey: 'unenroll-lab',
    });
    expect(enrollment).toBeNull();
  });

  it('returns 404 when not enrolled', async () => {
    const res = await request(app).delete('/v1/user/labs/nonexistent');
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run the tests**

Run: `bun run test tests/controllers/labsController.test.ts`

All tests should pass.

**Step 3: Commit**

```
test: add integration tests for labs controller (list, enroll, unenroll)
```

---

### Task 9: Update Frontend Store

**Files:**
- Modify: `frontend/app/stores/labs.ts`

**Step 1: Update the store**

```typescript
import { defineStore } from 'pinia';

interface UserFeature {
  key: string;
  name?: string;
  description?: string;
  active: boolean;
  userControllable: boolean;
  userOptedIn?: boolean;
}

export const useLabsStore = defineStore('labs', {
  state: () => ({
    features: [] as UserFeature[],
    loaded: false,
  }),
  getters: {
    isFeatureEnabled: (state) => (key: string) => {
      const feature = state.features.find((f) => f.key === key);
      return feature?.active ?? false;
    },
    labFeatures: (state) => state.features.filter((f) => f.userControllable),
  },
  persist: import.meta.client
    ? {
        key: 'labs',
        storage: piniaPluginPersistedstate.localStorage(),
        pick: ['features'],
      }
    : false,
  actions: {
    async fetchFeatures() {
      try {
        const features = await $fetch<UserFeature[]>('/v1/user/labs', {
          credentials: 'include',
        });
        this.features = features;
        this.loaded = true;
      } catch (error) {
        console.error('[Labs] Failed to fetch features:', error);
      }
    },
    async toggleLab(key: string, enable: boolean) {
      const method = enable ? 'POST' : 'DELETE';
      await $fetch(`/v1/user/labs/${key}`, { method, credentials: 'include' });

      const feature = this.features.find((f) => f.key === key);
      if (feature) {
        feature.active = enable;
        feature.userOptedIn = enable;
      }
    },
  },
});
```

Key changes:
- `UserLabFeature` → `UserFeature` (covers both labs and flags)
- `isFeatureEnabled` checks `active` instead of `enabled && userEnabled`
- New `labFeatures` getter for the settings UI (filters to `userControllable: true`)
- `updateUserOptIn` → `toggleLab` which calls the new POST/DELETE endpoints
- `fetchFeatures` still fetches from `/v1/user/labs`

**Step 2: Update any frontend components that use `updateUserOptIn`**

Search the frontend for `updateUserOptIn` calls and replace with `toggleLab(key, enabled)`.

**Step 3: Commit**

```
feat: update frontend labs store for new response shape and enrollment endpoints
```

---

### Task 10: Cleanup — Remove `preferences.labs` Usage from `updateUserPreferences`

**Files:**
- Verify: `app/controllers/preferencesController.ts` — no lab-specific handling needed (deepMerge is generic)
- Verify: no other files reference `preferences.labs`

**Step 1: Grep for remaining `preferences.labs` or `preferences?.labs` references**

Run: `grep -r "preferences.*labs" app/` and verify nothing references the old path.

If the `updateUserPreferences` endpoint's OpenAPI schema still allows a `labs` property, remove it from the schema and regenerate.

**Step 2: Commit (if changes needed)**

```
refactor: remove remaining preferences.labs references
```

---

## Execution Notes

- Run `bun run generate:all` after every OpenAPI schema change (Task 5, Task 7)
- The migration (Task 2) migrates existing `preferences.labs` data — run after deploying the new table
- The test DB schema needs updating: `pg_dump --schema-only nadedb | psql nadeshiko_test` (or run the migration against the test DB)
- The auth middleware change (Task 3) adds a JOIN but is cached — minimal perf impact
- Feature flag 0% rollout edge case: `rolloutPercentage: 0` means nobody qualifies via percentage, but `allowedUserIds` can still override
