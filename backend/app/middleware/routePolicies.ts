import type { Request, Response, RequestHandler } from 'express';
import { requireApiKeyAuth, requireSessionAuth } from '@app/middleware/authentication';
import { AuthType, ApiPermission } from '@app/models/ApiPermission';
import { requirePermissions } from '@app/middleware/authorization';
import { rateLimitApiQuota } from '@app/middleware/apiLimiterQuota';
import { InsufficientPermissionsError } from '@app/errors';

export { ApiPermission };

const runMiddleware = (middleware: RequestHandler, req: Request, res: Response): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const result = middleware(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve();
    });

    if (result instanceof Promise) {
      result.catch(reject);
    }
  });

export const requireAuth = (...authorizers: RequestHandler[]): RequestHandler => {
  return async (req, res, next) => {
    try {
      const hasBearer = req.headers.authorization?.startsWith('Bearer ');
      if (hasBearer) {
        await runMiddleware(requireApiKeyAuth, req, res);
      } else {
        await runMiddleware(requireSessionAuth, req, res);
      }

      await runMiddleware(rateLimitApiQuota, req, res);

      for (const authorizer of authorizers) {
        await runMiddleware(authorizer, req, res);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

export const requireSession = (...authorizers: RequestHandler[]): RequestHandler => {
  return async (req, res, next) => {
    try {
      await runMiddleware(requireSessionAuth, req, res);

      for (const authorizer of authorizers) {
        await runMiddleware(authorizer, req, res);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

export const enforceAdminAccess: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN') {
    throw new InsufficientPermissionsError('Admin access required.');
  }

  next();
};

export const enforceSessionAdmin: RequestHandler = (req, _res, next) => {
  if (req.auth?.type !== AuthType.SESSION) {
    next();
    return;
  }

  if (req.user?.role !== 'ADMIN') {
    throw new InsufficientPermissionsError('Admin access required.');
  }

  next();
};

export const enforceApiKeyScope = (...permissions: ApiPermission[]): RequestHandler => {
  return (req, res, next) => {
    if (req.auth?.type === AuthType.SESSION) {
      next();
      return;
    }

    const permissionsMiddleware = requirePermissions(...permissions);
    permissionsMiddleware(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      next();
    });
  };
};
