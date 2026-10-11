import { instrumentElasticsearchClient } from '@app/middleware/esInstrumentation';
import { seedInFlightLimitSeries } from '@app/middleware/inFlightLimit';
import { seedRateLimitSeries } from '@app/middleware/rateLimit';
import { seedEmailSeries } from '@app/services/email/metrics';
import { client as esClient } from '@config/elasticsearch';
import { startSeriesHeartbeat } from '@config/telemetry';
import { registerCacheMetrics } from '@lib/cache';
import type { RuntimeInitializer } from './types';

/** Re-emit seeded zero-series on one shared interval because DELTA exports go quiet after the seed; the interval
 * must remain within alert lookback windows and the timer must not keep the process alive. */
let stopHeartbeat: (() => void) | null = null;

export const telemetryInitializer: RuntimeInitializer = {
  name: 'telemetry',
  initialize: () => {
    instrumentElasticsearchClient(esClient);
    // Observable, so there is nothing to heartbeat: the callback runs on every
    // collection and reports every namespace, including the empty ones.
    registerCacheMetrics();
    stopHeartbeat = startSeriesHeartbeat([seedEmailSeries, seedRateLimitSeries, seedInFlightLimitSeries]);
  },
  shutdown: () => {
    stopHeartbeat?.();
    stopHeartbeat = null;
  },
};
