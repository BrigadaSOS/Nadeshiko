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

/** Mount the auth surface as `config/routes.ts` does; `createTestApp` omits the better-auth handler where this guard
 * runs. */
const auth = betterAuth(buildAuthOptions());
const app = buildApplication({
  rateLimit: false,
  mountRoutes: (instance) => {
    instance.all('/v1/auth/*splat', toNodeHandler(auth));
  },
});

/** A suppressed magic-link address must be refused to the caller, not merely dropped in `sendEmail`; otherwise the
 * UI reports success while the locked account receives nothing. */
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
