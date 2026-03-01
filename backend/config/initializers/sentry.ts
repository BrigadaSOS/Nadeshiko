import { initSentry, shutdownSentry } from '@config/sentry';
import type { RuntimeInitializer } from './types';

export const sentryInitializer: RuntimeInitializer = {
  name: 'sentry',
  initialize: () => {
    initSentry();
  },
  shutdown: async () => {
    await shutdownSentry();
  },
};
