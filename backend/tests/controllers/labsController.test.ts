import request from 'supertest';
import { describe, it, expect, afterEach } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { invalidateExperimentCache } from '@lib/experiments';
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
    expect(res.body).toEqual([
      {
        key: 'test-lab',
        name: 'Test Lab',
        description: 'A test lab',
        active: false,
        userControllable: true,
        userOptedIn: false,
      },
    ]);
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

  it('includes active enforced experiments as non-controllable', async () => {
    fixtures = await seedCoreFixtures(app);
    await Experiment.save({
      key: 'test-flag',
      enforced: true,
      enabled: true,
      rolloutPercentage: 0,
      allowedUserIds: [fixtures.users.kevin.id],
    });

    const res = await request(app).get('/v1/user/labs');
    expect(res.body).toEqual([
      {
        key: 'test-flag',
        active: true,
        userControllable: false,
      },
    ]);
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
