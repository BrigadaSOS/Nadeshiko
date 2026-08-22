import { instrumentElasticsearchClient } from '@app/middleware/esInstrumentation';
import { seedRateLimitSeries } from '@app/middleware/rateLimit';
import { seedEmailSeries } from '@app/services/email/metrics';
import { client as esClient } from '@config/elasticsearch';
import { startSeriesHeartbeat } from '@config/telemetry';
import { registerCacheMetrics } from '@lib/cache';
import type { RuntimeInitializer } from './types';

/**
 * One heartbeat for every series whose healthy value is zero.
 *
 * These counters are seeded so their alert rules have something to read, and
 * under DELTA temporality a seeded counter emits once and then goes quiet -- so
 * an hour after each deploy the rules go back to matching nothing and
 * NadeshikoAlertRuleMatchesNothing starts firing about them. The reasoning, the
 * measurement and the interval are in @config/telemetry.
 *
 * Kept in ONE list rather than a timer per module: the interval is a contract
 * with the alert rules' lookback windows, and a second copy of it would drift
 * from the first.
 */
let stopHeartbeat: (() => void) | null = null;

export const telemetryInitializer: RuntimeInitializer = {
  name: 'telemetry',
  initialize: () => {
    instrumentElasticsearchClient(esClient);
    // Observable, so there is nothing to heartbeat: the callback runs on every
    // collection and reports every namespace, including the empty ones.
    registerCacheMetrics();
    stopHeartbeat = startSeriesHeartbeat([seedEmailSeries, seedRateLimitSeries]);
  },
  shutdown: () => {
    stopHeartbeat?.();
    stopHeartbeat = null;
  },
};
