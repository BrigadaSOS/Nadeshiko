import { registerSuppressionMetrics } from '@app/services/email/suppression';
import type { RuntimeInitializer } from './types';

/**
 * Register the suppression gauge, which reads the suppression table at scrape
 * time and therefore has to come after `databaseInitializer`.
 *
 * THE SEEDING THAT USED TO LIVE HERE MOVED, and it moved because doing it once
 * was not enough. Every enumerable email series is still created at zero so its
 * alert rule has something to read -- an OTel counter creates its series on
 * first increment, so a counter for something that has never happened does not
 * exist, `increase(...) > 0` over it evaluates to NO DATA rather than to false,
 * and the rule reports healthy forever. Shirabe shipped the same feature
 * without it and four of its five email rules were inert from their first day.
 *
 * But these exports are DELTA, so a seeded counter emits one data point and then
 * goes silent, and the rule stops matching an hour after each deploy. The seed
 * is therefore re-emitted on an interval by `telemetryInitializer`, whose module
 * note carries the measurement. `seedEmailSeries()` itself is unchanged, in
 * @app/services/email/metrics.
 *
 * Seeding also makes the bounce RATE honest: a numerator over a denominator that
 * does not exist is not zero, it is nothing.
 */
export const emailInitializer: RuntimeInitializer = {
  name: 'email',
  initialize: () => {
    registerSuppressionMetrics();
  },
};
