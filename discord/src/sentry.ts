import * as Sentry from '@sentry/node';
import packageJson from '../package.json';

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: packageJson.version,
    tracesSampleRate: 1.0,
  });
}

export async function shutdownSentry() {
  await Sentry.close();
}

export { Sentry };
