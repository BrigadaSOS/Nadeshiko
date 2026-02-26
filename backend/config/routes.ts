import type { Application, NextFunction, Request, Response } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '@config/auth';
import { router } from '@app/routes/router';
import { invalidateAuthCachesAfterMutation } from '@app/middleware/authCacheInvalidation';

export const noCache = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  next();
};

export function mountRoutes(app: Application): Application {
  app.get('/up', (_req, res) => res.status(200).send('OK'));
  app.all('/v1/auth', noCache, invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.all('/v1/auth/*splat', noCache, invalidateAuthCachesAfterMutation, toNodeHandler(auth));
  app.use('/', router);
  return app;
}
