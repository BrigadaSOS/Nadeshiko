import { describe, it, expect, vi } from 'bun:test';
import { requirePermissions } from '@app/middleware/authorization';
import { ApiPermission } from '@app/models/ApiPermission';
import { InsufficientPermissionsError } from '@app/errors';

describe('requirePermissions', () => {
  it('calls next() when user has all required permissions', () => {
    const middleware = requirePermissions(ApiPermission.READ_MEDIA);
    const req = {
      auth: { apiKey: { permissions: [ApiPermission.READ_MEDIA, ApiPermission.ADD_MEDIA] } },
    } as any;
    const res = {} as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws InsufficientPermissionsError when missing a permission', () => {
    const middleware = requirePermissions(ApiPermission.UPDATE_MEDIA);
    const req = {
      auth: { apiKey: { permissions: [ApiPermission.READ_MEDIA] } },
    } as any;
    const res = {} as any;
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(InsufficientPermissionsError);
    expect(next).not.toHaveBeenCalled();
  });

  it('includes missing permission names in the error message', () => {
    const middleware = requirePermissions(ApiPermission.UPDATE_MEDIA, ApiPermission.REMOVE_MEDIA);
    const req = {
      auth: { apiKey: { permissions: [ApiPermission.READ_MEDIA] } },
    } as any;
    const res = {} as any;
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(/UPDATE_MEDIA, REMOVE_MEDIA/);
  });

  it('calls next() when no permissions are required', () => {
    const middleware = requirePermissions();
    const req = { auth: { apiKey: { permissions: [] } } } as any;
    const res = {} as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws when req.auth is undefined (no auth context)', () => {
    const middleware = requirePermissions(ApiPermission.READ_MEDIA);
    const req = {} as any;
    const res = {} as any;
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow(InsufficientPermissionsError);
  });
});
