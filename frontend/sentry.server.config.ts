import * as Sentry from '@sentry/nuxt';

Sentry.init({
  dsn: process.env.SENTRY_FRONTEND_DSN,
  environment: process.env.NUXT_PUBLIC_ENVIRONMENT || 'production',
  tracesSampleRate: 1.0,
});
