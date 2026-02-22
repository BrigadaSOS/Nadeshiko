import { User } from '@app/models';
import { AccessDeniedError, NotFoundError } from '@app/errors';
import {
  toAdminImpersonationClearedResponse,
  toAdminImpersonationCreatedResponse,
} from '@app/controllers/mappers/devAuth.mapper';
import { auth, BETTER_AUTH_SESSION_COOKIE_ALIASES } from '@config/auth';
import { isLocalEnvironment } from '@config/environment';
import { serializeSignedCookie } from 'better-call';
import type { Request, Response } from 'express';
import type { ImpersonateAdminUser, ClearAdminImpersonation } from 'generated/routes/admin';

const DEV_IMPERSONATION_COOKIE = 'ndk_dev_impersonation';
type AuthContext = Awaited<typeof auth.$context>;

export const impersonateAdminUser: ImpersonateAdminUser = async ({ body }, respond, req, res) => {
  assertLocalDevelopmentImpersonationEnabled();
  const user = await findImpersonationUser(body.userId);

  const authContext = await auth.$context;
  const signedSessionCookie = await createSignedSessionCookieForUser(user.id, req, authContext);

  res.append('Set-Cookie', signedSessionCookie);
  res.clearCookie(DEV_IMPERSONATION_COOKIE, { path: '/' });
  return respond.with200().body(toAdminImpersonationCreatedResponse(user));
};

export const clearAdminImpersonation: ClearAdminImpersonation = async (_params, respond, req, res) => {
  assertLocalDevelopmentImpersonationEnabled();

  const authContext = await auth.$context;
  await deleteSessionFromCookieHeader(req.headers.cookie, authContext);
  clearImpersonationCookies(res, authContext);
  return respond.with200().body(toAdminImpersonationClearedResponse());
};

function assertLocalDevelopmentImpersonationEnabled(): void {
  if (!isLocalEnvironment()) {
    throw new AccessDeniedError('Development impersonation is only available in local environment.');
  }
}

async function findImpersonationUser(userId: number): Promise<User> {
  const user = await User.findOne({ where: { id: userId } });
  if (!user) {
    throw NotFoundError.forUser();
  }
  return user;
}

async function createSignedSessionCookieForUser(
  userId: number,
  req: Request,
  authContext: AuthContext,
): Promise<string> {
  const session = await authContext.internalAdapter.createSession(String(userId), false, {
    ipAddress: resolveRequestIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  // Better Auth reads this with getSignedCookie(), so raw session token cookies are ignored.
  return serializeSignedCookie(
    authContext.authCookies.sessionToken.name,
    session.token,
    authContext.secret,
    authContext.authCookies.sessionToken.attributes,
  );
}

function resolveRequestIp(req: Request): string | null {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
    const firstForwardedIp = forwardedFor.split(',')[0]?.trim();
    if (firstForwardedIp) {
      return firstForwardedIp;
    }
  }

  if (typeof req.ip === 'string' && req.ip.trim().length > 0) {
    return req.ip.trim();
  }

  return null;
}

async function deleteSessionFromCookieHeader(
  cookieHeader: string | undefined,
  authContext: AuthContext,
): Promise<void> {
  const sessionToken = findCookieValueByNames(cookieHeader, [
    authContext.authCookies.sessionToken.name,
    ...BETTER_AUTH_SESSION_COOKIE_ALIASES,
  ]);
  if (!sessionToken) {
    return;
  }

  const signedPayload = extractSignedCookiePayload(sessionToken);
  const candidateTokens =
    signedPayload && signedPayload !== sessionToken ? [signedPayload, sessionToken] : [sessionToken];

  try {
    for (const candidateToken of candidateTokens) {
      await authContext.internalAdapter.deleteSession(candidateToken);
    }
  } catch {
    // no-op: clearing cookies is enough when session token is already invalid
  }
}

function findCookieValueByNames(cookieHeader: string | undefined, cookieNames: readonly string[]): string | null {
  for (const cookieName of cookieNames) {
    const value = findCookieValue(cookieHeader, cookieName);
    if (value) {
      return value;
    }
  }
  return null;
}

function findCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const target = `${cookieName}=`;
  for (const rawPart of cookieHeader.split(';')) {
    const part = rawPart.trim();
    if (part.startsWith(target)) {
      return decodeURIComponent(part.slice(target.length));
    }
  }
  return null;
}

function extractSignedCookiePayload(cookieValue: string): string | null {
  const signatureSeparatorIndex = cookieValue.lastIndexOf('.');
  if (signatureSeparatorIndex <= 0) {
    return null;
  }

  const signature = cookieValue.slice(signatureSeparatorIndex + 1);
  if (signature.length !== 44 || !signature.endsWith('=')) {
    return null;
  }

  return cookieValue.slice(0, signatureSeparatorIndex);
}

function clearImpersonationCookies(res: Response, authContext: AuthContext): void {
  res.clearCookie(authContext.authCookies.sessionToken.name, authContext.authCookies.sessionToken.attributes as any);
  res.clearCookie(authContext.authCookies.sessionData.name, authContext.authCookies.sessionData.attributes as any);
  res.clearCookie(DEV_IMPERSONATION_COOKIE, { path: '/' });

  for (const alias of BETTER_AUTH_SESSION_COOKIE_ALIASES) {
    if (alias !== authContext.authCookies.sessionToken.name) {
      res.clearCookie(alias, { path: '/' });
    }
  }
}
