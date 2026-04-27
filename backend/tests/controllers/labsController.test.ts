import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});
beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

describe('GET /v1/user/labs', () => {
  it('returns an empty list when no labs are defined', async () => {
    const res = await request(app).get('/v1/user/labs');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /v1/user/labs/:key', () => {
  it('returns 404 for non-existent lab', async () => {
    const res = await request(app).post('/v1/user/labs/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /v1/user/labs/:key', () => {
  it('returns 404 when not enrolled', async () => {
    const res = await request(app).delete('/v1/user/labs/nonexistent');
    expect(res.status).toBe(404);
  });
});
