import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { LabEnrollment } from '@app/models/LabEnrollment';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});
beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

async function signInAsKevinWithEnrollments() {
  const user = fixtures.users.kevin;
  user.labEnrollments = await LabEnrollment.findBy({ userId: user.id });
  signInAs(app, user);
}

describe('GET /v1/user/labs', () => {
  it('returns labs with active: false when not enrolled', async () => {
    const res = await request(app).get('/v1/user/labs');

    expect(res.status).toBe(200);
    expect(res.body).toBeArray();
    for (const lab of res.body) {
      expect(lab).toMatchObject({ active: false });
      expect(lab).toHaveProperty('key');
      expect(lab).toHaveProperty('name');
      expect(lab).toHaveProperty('description');
    }
  });

  it('shows enrolled lab as active', async () => {
    await LabEnrollment.save({
      userId: fixtures.users.kevin.id,
      labKey: 'interactive-tokens',
    });

    await signInAsKevinWithEnrollments();

    const res = await request(app).get('/v1/user/labs');
    const lab = res.body.find((l: { key: string }) => l.key === 'interactive-tokens');
    expect(lab).toMatchObject({ active: true });
  });
});

describe('POST /v1/user/labs/:key', () => {
  it('enrolls user in a lab', async () => {
    const res = await request(app).post('/v1/user/labs/interactive-tokens');
    expect(res.status).toBe(204);

    const enrollment = await LabEnrollment.findOneBy({
      userId: fixtures.users.kevin.id,
      labKey: 'interactive-tokens',
    });
    expect(enrollment).not.toBeNull();
  });

  it('returns 404 for non-existent lab', async () => {
    const res = await request(app).post('/v1/user/labs/nonexistent');
    expect(res.status).toBe(404);
  });

  it('is idempotent — enrolling twice creates only one record', async () => {
    await request(app).post('/v1/user/labs/interactive-tokens').expect(204);
    await request(app).post('/v1/user/labs/interactive-tokens').expect(204);

    const count = await LabEnrollment.countBy({
      userId: fixtures.users.kevin.id,
      labKey: 'interactive-tokens',
    });
    expect(count).toBe(1);
  });
});

describe('DELETE /v1/user/labs/:key', () => {
  it('unenrolls user from a lab', async () => {
    await LabEnrollment.save({
      userId: fixtures.users.kevin.id,
      labKey: 'interactive-tokens',
    });

    const res = await request(app).delete('/v1/user/labs/interactive-tokens');
    expect(res.status).toBe(204);

    const enrollment = await LabEnrollment.findOneBy({
      userId: fixtures.users.kevin.id,
      labKey: 'interactive-tokens',
    });
    expect(enrollment).toBeNull();
  });

  it('returns 404 when not enrolled', async () => {
    const res = await request(app).delete('/v1/user/labs/nonexistent');
    expect(res.status).toBe(404);
  });
});
