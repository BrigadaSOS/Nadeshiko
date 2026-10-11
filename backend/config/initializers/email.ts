import { registerSuppressionMetrics } from '@app/services/email/suppression';
import type { RuntimeInitializer } from './types';

/** Register suppression metrics after the database initializer. Seed every series because absent zero-series make
 * alert expressions read as no data, then re-emit them from telemetry because DELTA counters go quiet after one
 * export. */
export const emailInitializer: RuntimeInitializer = {
  name: 'email',
  initialize: () => {
    registerSuppressionMetrics();
  },
};
