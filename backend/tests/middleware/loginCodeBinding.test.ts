import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Application } from 'express';
import { request } from '../helpers/http';
import { loginCodeBinding } from '@app/middleware/loginCodeBinding';
import { LOGIN_CODE_COOKIE, issueLoginCodeBinding } from '@app/services/auth/loginCode';

let app: Application;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(loginCodeBinding);
  // Stands in for better-auth: echoes what reached it, so the assertions can be
  // about what the middleware let through and how it rewrote it.
  app.all('*splat', (req, res) => res.status(200).json({ reached: true, body: req.body }));
});

const cookieFor = (email: string) => `${LOGIN_CODE_COOKIE}=${encodeURIComponent(issueLoginCodeBinding(email))}`;

describe('asking for a sign-in mail', () => {
  it('leaves a claim naming the address', async () => {
    const response = await request(app).post('/v1/auth/sign-in/magic-link').send({ email: 'reader@example.com' });

    expect(response.status).toBe(200);
    const cookie = response.headers['set-cookie']?.find((value: string) => value.startsWith(LOGIN_CODE_COOKIE));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('does not set a claim when no address was given', async () => {
    const response = await request(app).post('/v1/auth/sign-in/magic-link').send({});

    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('spending a sign-in code', () => {
  it('lets the browser that asked through', async () => {
    const response = await request(app)
      .post('/v1/auth/sign-in/email-otp')
      .set('Cookie', cookieFor('reader@example.com'))
      .send({ email: 'reader@example.com', otp: 'X5KDNZ' });

    expect(response.status).toBe(200);
    expect(response.body.reached).toBe(true);
  });

  /**
   * THE ATTACK THIS EXISTS FOR. Somebody is phoned, told there is a problem with
   * their account, and asked to read out the code that just arrived. In the
   * caller's browser — which never asked and holds no claim — it is worthless.
   */
  it('refuses a browser that never asked', async () => {
    const response = await request(app)
      .post('/v1/auth/sign-in/email-otp')
      .send({ email: 'reader@example.com', otp: 'X5KDNZ' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('LOGIN_CODE_NOT_BOUND');
  });

  it('refuses a claim for a different address', async () => {
    const response = await request(app)
      .post('/v1/auth/sign-in/email-otp')
      .set('Cookie', cookieFor('someone-else@example.com'))
      .send({ email: 'reader@example.com', otp: 'X5KDNZ' });

    expect(response.status).toBe(400);
  });

  /**
   * Refused BEFORE better-auth sees it, so a stranger's guesses cannot burn the
   * five attempts belonging to the reader who actually asked.
   */
  it('does not reach the auth handler when refused', async () => {
    const response = await request(app)
      .post('/v1/auth/sign-in/email-otp')
      .send({ email: 'reader@example.com', otp: 'X5KDNZ' });

    expect(response.body.reached).toBeUndefined();
  });

  it('normalizes the code on the way through', async () => {
    const response = await request(app)
      .post('/v1/auth/sign-in/email-otp')
      .set('Cookie', cookieFor('reader@example.com'))
      .send({ email: 'reader@example.com', otp: ' x5kd-nz ' });

    expect(response.body.body.otp).toBe('X5KDNZ');
  });

  /**
   * A code of the wrong length is passed through untouched rather than repaired
   * into something else: better-auth refuses it and counts the attempt, which is
   * the correct outcome for a wrong guess.
   */
  it('leaves an unrecognisable code alone', async () => {
    const response = await request(app)
      .post('/v1/auth/sign-in/email-otp')
      .set('Cookie', cookieFor('reader@example.com'))
      .send({ email: 'reader@example.com', otp: 'nope' });

    expect(response.body.body.otp).toBe('nope');
  });
});

describe('every other auth route', () => {
  it('is untouched', async () => {
    for (const path of ['/v1/auth/sign-out', '/v1/auth/get-session', '/v1/auth/sign-in/social']) {
      const response = await request(app).post(path).send({ email: 'reader@example.com' });
      expect(response.status).toBe(200);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });
});
