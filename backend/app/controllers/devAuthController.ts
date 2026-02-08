import { User } from '@app/entities';
import { DEV_IMPERSONATION_COOKIE } from '@app/services/devImpersonation';
import { auth, BETTER_AUTH_SESSION_COOKIE_ALIASES } from '@lib/auth';
import { isLocalEnvironment } from '@lib/environment';
import { AccessDeniedError, InvalidRequestError, NotFoundError } from '@lib/utils/apiErrors';
import { serializeSignedCookie } from 'better-call';
import { Request, Response } from 'express';

function readCookieValue(req: Request, cookieName: string): string | null {
  const cookieHeader = req.headers.cookie;
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

function readCookieValueFromNames(req: Request, cookieNames: string[]): string | null {
  for (const cookieName of cookieNames) {
    const value = readCookieValue(req, cookieName);
    if (value) {
      return value;
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

export async function impersonateUserForDevelopment(req: Request, res: Response): Promise<void> {
  if (!isLocalEnvironment()) {
    throw new AccessDeniedError('Development impersonation is only available in local environment.');
  }

  const userId = Number(req.body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new InvalidRequestError('`userId` must be a positive integer.');
  }

  const user = await User.findOne({ where: { id: userId } });
  if (!user) {
    throw NotFoundError.forUser();
  }

  const authContext = await auth.$context;
  const session = await authContext.internalAdapter.createSession(String(user.id), false, {
    ipAddress: resolveRequestIp(req),
    userAgent: req.get('user-agent') ?? null,
  });

  // Better Auth reads this with getSignedCookie(), so raw session token cookies are ignored.
  const signedSessionCookie = await serializeSignedCookie(
    authContext.authCookies.sessionToken.name,
    session.token,
    authContext.secret,
    authContext.authCookies.sessionToken.attributes,
  );
  res.append('Set-Cookie', signedSessionCookie);
  res.clearCookie(DEV_IMPERSONATION_COOKIE, { path: '/' });

  res.status(200).json({
    message: 'Development impersonation session created.',
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
  });
}

export async function clearDevelopmentImpersonation(req: Request, res: Response): Promise<void> {
  if (!isLocalEnvironment()) {
    throw new AccessDeniedError('Development impersonation is only available in local environment.');
  }

  const authContext = await auth.$context;
  const sessionCookieName = authContext.authCookies.sessionToken.name;
  const sessionToken = readCookieValueFromNames(req, [sessionCookieName, ...BETTER_AUTH_SESSION_COOKIE_ALIASES]);
  if (sessionToken) {
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

  res.clearCookie(authContext.authCookies.sessionToken.name, authContext.authCookies.sessionToken.attributes as any);
  res.clearCookie(authContext.authCookies.sessionData.name, authContext.authCookies.sessionData.attributes as any);
  res.clearCookie(DEV_IMPERSONATION_COOKIE, { path: '/' });

  for (const alias of BETTER_AUTH_SESSION_COOKIE_ALIASES) {
    if (alias !== authContext.authCookies.sessionToken.name) {
      res.clearCookie(alias, { path: '/' });
    }
  }

  res.status(200).json({
    message: 'Development impersonation session cleared.',
  });
}
