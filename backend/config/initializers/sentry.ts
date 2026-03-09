import { shutdownSentry } from '@config/sentry';
import type { RuntimeInitializer } from './types';

export const sentryInitializer: RuntimeInitializer = {
  name: 'sentry',
  initialize: () => {
    // Sentry.init() is called in main.ts before buildApplication()
    // so that setupExpressErrorHandler sees an active SDK.
  },
  shutdown: async () => {
    await shutdownSentry();
  },
};
