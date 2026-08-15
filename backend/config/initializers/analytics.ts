import { shutdownAnalytics } from '@app/services/analytics/posthog';
import type { RuntimeInitializer } from './types';

/**
 * Exists for its shutdown half.
 *
 * The PostHog client builds itself lazily on first capture, so there is nothing
 * to start. What there is to do is flush: events are batched, and a deploy that
 * kills the process without draining the queue silently loses up to ten seconds
 * of signups -- which are precisely the events this was added to stop losing.
 */
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
