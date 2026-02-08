import { User } from '@app/entities';
import {
  DEV_IMPERSONATION_COOKIE,
  DEV_IMPERSONATION_TTL_SECONDS,
  createDevImpersonationSession,
  revokeDevImpersonationSession,
} from '@app/services/devImpersonation';
import { AccessDeniedError, InvalidRequestError, NotFoundError } from '@lib/utils/apiErrors';
import { Request, Response } from 'express';

function isProductionEnvironment(): boolean {
  return process.env.ENVIRONMENT === 'production';
}

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

export async function impersonateUserForDevelopment(req: Request, res: Response): Promise<void> {
  if (isProductionEnvironment()) {
    throw new AccessDeniedError('Development impersonation is disabled in production.');
  }

  const userId = Number(req.body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new InvalidRequestError('`userId` must be a positive integer.');
  }

  const user = await User.findOne({ where: { id: userId } });
  if (!user) {
    throw NotFoundError.forUser();
  }

  const token = createDevImpersonationSession(user.id);

  res.cookie(DEV_IMPERSONATION_COOKIE, token, {
    maxAge: DEV_IMPERSONATION_TTL_SECONDS * 1000,
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
  });

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
  if (isProductionEnvironment()) {
    throw new AccessDeniedError('Development impersonation is disabled in production.');
  }

  const token = readCookieValue(req, DEV_IMPERSONATION_COOKIE);
  if (token) {
    revokeDevImpersonationSession(token);
  }

  res.clearCookie(DEV_IMPERSONATION_COOKIE, {
    path: '/',
  });

  res.status(200).json({
    message: 'Development impersonation session cleared.',
  });
}
