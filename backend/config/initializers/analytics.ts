import { shutdownAnalytics } from '@app/services/analytics/posthog';
import type { RuntimeInitializer } from './types';

/** The PostHog client starts lazily; shutdown must flush its batched events or a deploy can lose recent signups. */
export const analyticsInitializer: RuntimeInitializer = {
  name: 'analytics',
  initialize: () => {
    // Nothing to do. Capture is lazy and configuration is validated at boot by
    // the env schema.
  },
  shutdown: async () => {
    await shutdownAnalytics();
  },
};
