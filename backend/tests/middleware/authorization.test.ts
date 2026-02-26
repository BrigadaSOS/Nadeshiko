import { describe, it, expect, vi } from 'bun:test';
import { requirePermissions } from '@app/middleware/authorization';
import { ApiPermission } from '@app/models/ApiPermission';
import { InsufficientPermissionsError } from '@app/errors';
import type { Request, Response, NextFunction } from 'express';

describe('requirePermissions', () => {
  it('calls next() when user has all required permissions', () => {
    const { run, next } = callMiddleware([ApiPermission.READ_MEDIA, ApiPermission.ADD_MEDIA], ApiPermission.READ_MEDIA);
    run();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws InsufficientPermissionsError when missing a permission', () => {
    const { run, next } = callMiddleware([ApiPermission.READ_MEDIA], ApiPermission.UPDATE_MEDIA);
    expect(run).toThrow(InsufficientPermissionsError);
    expect(next).not.toHaveBeenCalled();
  });

  it('includes missing permission names in the error message', () => {
    const { run } = callMiddleware([ApiPermission.READ_MEDIA], ApiPermission.UPDATE_MEDIA, ApiPermission.REMOVE_MEDIA);
    expect(run).toThrow(/UPDATE_MEDIA, REMOVE_MEDIA/);
  });

  it('calls next() when no permissions are required', () => {
    const { run, next } = callMiddleware([]);
    run();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws when req.auth is undefined (no auth context)', () => {
    const { run } = callMiddleware(undefined, ApiPermission.READ_MEDIA);
    expect(run).toThrow(InsufficientPermissionsError);
  });
});

function callMiddleware(permissions: ApiPermission[] | undefined, ...required: ApiPermission[]) {
  const middleware = requirePermissions(...required);
  const req = (permissions !== undefined ? { auth: { apiKey: { permissions } } } : {}) as Request;
  const next = vi.fn() as unknown as NextFunction;
  return { run: () => middleware(req, {} as Response, next), next };
}
