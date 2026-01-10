import { nanoid } from 'nanoid';

type DevSession = {
  userId: number;
  expiresAtMs: number;
};

export const DEV_IMPERSONATION_COOKIE = 'ndk_dev_impersonation';
export const DEV_IMPERSONATION_TTL_SECONDS = 12 * 60 * 60;

const sessions = new Map<string, DevSession>();

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAtMs <= now) {
      sessions.delete(token);
    }
  }
}

export function createDevImpersonationSession(userId: number): string {
  cleanupExpiredSessions();
  const token = nanoid(48);
  const expiresAtMs = Date.now() + DEV_IMPERSONATION_TTL_SECONDS * 1000;
  sessions.set(token, { userId, expiresAtMs });
  return token;
}

export function getDevImpersonationSession(token: string): DevSession | null {
  cleanupExpiredSessions();
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  return session.expiresAtMs > Date.now() ? session : null;
}

export function revokeDevImpersonationSession(token: string): void {
  sessions.delete(token);
}
