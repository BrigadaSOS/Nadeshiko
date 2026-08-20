import { seedEmailSeries } from '@app/services/email/metrics';
import { registerSuppressionMetrics } from '@app/services/email/suppression';
import type { RuntimeInitializer } from './types';

/**
 * Make every email series exist before anything has happened to it.
 *
 * THIS IS NOT COSMETIC, and it is the step that is easiest to skip and hardest
 * to notice missing. An OTel counter creates its series on first increment, so a
 * counter for something that has never happened does not exist -- and
 * `increase(...) > 0` over a metric with no series evaluates to NO DATA rather
 * than to false. The alert rule cannot fire, and a rule matching nothing looks
 * exactly like a healthy service.
 *
 * Shirabe shipped the same feature without this and four of its five email rules
 * were inert from the moment they were deployed; the meta-alert that watches for
 * rules matching no series is what eventually found them.
 *
 * Seeding also makes the bounce RATE honest: a numerator over a denominator that
 * does not exist is not zero, it is nothing.
 *
 * Runs after `databaseInitializer` because the suppression gauge reads the
 * table. The gauge is only REGISTERED here -- its callback runs at scrape time.
 */
export const emailInitializer: RuntimeInitializer = {
  name: 'email',
  initialize: () => {
    seedEmailSeries();
    registerSuppressionMetrics();
  },
};
