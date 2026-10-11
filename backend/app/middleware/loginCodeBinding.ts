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

/** Bind short sign-in codes to the requesting browser, but keep email links portable because they carry independent
 * high-entropy proof. */
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
        // Set the binding cookie before deciding whether mail is sent; an inert cookie is safer than branching on a
        // response that can be misread.
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
    // Use one response for missing, expired, and wrong-address cookies so probing cannot reveal which addresses have
    // active codes.
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

  // Normalize codes server-side so case, hyphens, and pasted spaces behave consistently for every caller.
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
