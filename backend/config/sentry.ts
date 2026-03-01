import * as Sentry from '@sentry/node';
import { config } from '@config/config';
import packageJson from '../package.json';

export function initSentry() {
  if (!config.SENTRY_BACKEND_DSN) return;

  Sentry.init({
    dsn: config.SENTRY_BACKEND_DSN,
    environment: config.ENVIRONMENT,
    release: packageJson.version,
    tracesSampleRate: 1.0,
  });
}

export async function shutdownSentry() {
  await Sentry.close();
}
