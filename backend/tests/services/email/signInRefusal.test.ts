import { request } from '../../helpers/http';
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import { buildApplication } from '@config/application';
import { buildAuthOptions } from '@config/auth';
import { suppress } from '@app/services/email/suppression';
import { User } from '@app/models';

setupTestSuite();

/**
 * The auth surface, mounted the way `config/routes.ts` mounts it. `createTestApp`
 * carries only the five route modules its callers need, so the better-auth
 * handler -- which is where the guard under test lives -- is not reachable there.
 */
const auth = betterAuth(buildAuthOptions());
const app = buildApplication({
  rateLimit: false,
  mountRoutes: (instance) => {
    instance.all('/v1/auth/*splat', toNodeHandler(auth));
  },
});

/**
 * Magic link is a sign-in path, so a suppressed address has to be refused OUT
 * LOUD. The check inside `sendEmail` would already stop the message, but it
 * stops it invisibly -- success to the caller, "check your inbox" on screen, and
 * nothing ever arrives. That is a locked account with no error message, which is
 * the failure this whole feature exists to end.
 */
describe('signing in with a suppressed address', () => {
  beforeEach(async () => {
    await User.save(
      User.create({
        username: `blocked-${Date.now()}`,
        email: 'blocked@example.com',
        isVerified: true,
        isActive: true,
      }),
    );
  });

  it('is refused with a reason the person can act on', async () => {
    await suppress({ address: 'blocked@example.com', cause: 'hard_bounce' });

    const response = await request(app).post('/v1/auth/sign-in/magic-link').send({ email: 'blocked@example.com' });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/different address/i);
  });

  it('still accepts an address that is not suppressed', async () => {
    const response = await request(app).post('/v1/auth/sign-in/magic-link').send({ email: 'blocked@example.com' });

    expect(response.status).toBe(200);
  });
});
