import { describe, it, expect } from 'bun:test';
import {
  toAdminImpersonationCreatedResponse,
  toAdminImpersonationClearedResponse,
} from '@app/controllers/mappers/devAuth.mapper';

describe('devAuth.mapper', () => {
  it('maps impersonation created payload', () => {
    const dto = toAdminImpersonationCreatedResponse({
      id: 11,
      username: 'user11',
      email: 'user11@example.test',
    } as any);

    expect(dto).toEqual({
      message: 'Impersonation session created.',
      user: {
        id: 11,
        username: 'user11',
        email: 'user11@example.test',
      },
    });
  });

  it('maps impersonation cleared payload', () => {
    expect(toAdminImpersonationClearedResponse()).toEqual({
      message: 'Impersonation session cleared.',
    });
  });
});
