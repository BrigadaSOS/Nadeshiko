import * as Sentry from '@sentry/nuxt';

const config = useRuntimeConfig();

if (config.public.sentryDsn) {
  Sentry.init({
    dsn: config.public.sentryDsn,
    environment: config.public.environment,
    integrations: [Sentry.replayIntegration()],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}
