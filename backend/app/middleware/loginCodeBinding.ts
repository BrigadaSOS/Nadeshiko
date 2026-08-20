import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '@config/config';
import { logger } from '@config/log';
import { APP_ENVIRONMENT, getAppEnvironment } from '@config/environment';
import {
  LOGIN_CODE_COOKIE,
  LOGIN_CODE_TTL_MS,
  issueLoginCodeBinding,
  normalizeLoginCode,
  readCookie,
  readLoginCodeBinding,
} from '@app/services/auth/loginCode';

/**
 * What ties a sign-in code to the browser that asked for it.
 *
 * A six-character code is short enough to read down a phone, which is exactly
 * the attack: somebody is called, told there is a problem with their account,
 * and asked to read out the code that just arrived. Every unbound OTP scheme has
 * this hole and it is the most common way they are defeated in practice.
 *
 * So asking for a sign-in mail leaves a sealed cookie naming the address it was
 * asked for, and a code is only ever accepted from a browser holding a cookie
 * for that same address. The code read out over the phone is worthless in the
 * caller's browser, because they never asked and have no cookie.
 *
 * THE LINK IS DELIBERATELY NOT BOUND. It carries 256 bits that only an inbox
 * ever holds, and its portability is the point -- it has to work when the mail
 * is opened on a phone and the session is wanted there. The two halves are
 * secured differently because they are exposed differently.
 *
 * Written as plain Express rather than a better-auth hook: it is a cookie in and
 * a cookie out around two known paths, and doing it here keeps it visible beside
 * the routes it guards instead of inside the auth options blob.
 */
const BINDING_PATHS = {
  issue: '/v1/auth/sign-in/magic-link',
  spend: '/v1/auth/sign-in/email-otp',
} as const;

function bodyEmail(req: Request): string | null {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

export const loginCodeBinding: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'POST') return next();

  if (req.path === BINDING_PATHS.issue) {
    const email = bodyEmail(req);
    if (email) {
      res.cookie(LOGIN_CODE_COOKIE, issueLoginCodeBinding(email), {
        httpOnly: true,
        sameSite: 'lax',
        // Set unconditionally, BEFORE better-auth decides whether to send. A
        // cookie naming an address no mail went to is inert -- there is no code
        // to spend against it -- while setting it only on success would mean
        // reading better-auth's response, and getting that wrong fails closed on
        // the sign-in path.
        secure: getAppEnvironment(config.ENVIRONMENT) !== APP_ENVIRONMENT.LOCAL,
        maxAge: LOGIN_CODE_TTL_MS,
        path: '/',
      });
    }
    return next();
  }

  if (req.path !== BINDING_PATHS.spend) return next();

  const claimed = bodyEmail(req);
  const bound = readLoginCodeBinding(readCookie(req.headers.cookie, LOGIN_CODE_COOKIE));

  if (!claimed || !bound || bound !== claimed) {
    // ONE MESSAGE FOR ALL THREE CASES -- no cookie, expired cookie, wrong
    // address. Telling them apart would tell somebody probing which addresses
    // have a code outstanding, and the reader's fix is the same either way.
    logger.info({ hasCookie: Boolean(bound) }, 'Refused a sign-in code: this browser did not ask for one');

    res.status(400).json({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail:
        'This code was not requested from this browser. Open the link in the email instead, or ask for a new code here.',
      code: 'LOGIN_CODE_NOT_BOUND',
    });
    return;
  }

  // Normalized on the way in, so `x5kd-nz` reaches better-auth as `X5KDNZ` and
  // matches what was hashed. Doing it here rather than in the client means a
  // paste with a stray space works from any caller, not just our own form.
  const body = req.body as { otp?: unknown };
  const normalized = normalizeLoginCode(typeof body.otp === 'string' ? body.otp : null);
  if (normalized) {
    body.otp = normalized;
  }

  return next();
};

/** Clears the claim, for "use a different address". The emailed link stays good. */
export function clearLoginCodeBinding(res: Response): void {
  res.clearCookie(LOGIN_CODE_COOKIE, { path: '/' });
}
