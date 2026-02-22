import type { User } from '@app/models';

export function toAdminImpersonationCreatedResponse(user: Pick<User, 'id' | 'username' | 'email'>) {
  return {
    message: 'Impersonation session created.',
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
  };
}

export function toAdminImpersonationClearedResponse() {
  return {
    message: 'Impersonation session cleared.',
  };
}
