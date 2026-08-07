import posthog from 'posthog-js';
import { createExceptionDeduper, exceptionSignature } from '~/utils/exceptionDedupe';

/**
 * Drops the second copy of every double-captured `$exception` (see
 * `~/utils/exceptionDedupe` for why there are two).
 *
 * `before_send` has to be installed here rather than through `posthogConfig`
 * because it is a function, and the module serialises its client config into
 * `runtimeConfig.public` where functions do not survive.
 */
export default defineNuxtPlugin({
  name: 'posthogExceptionDedupe',
  setup() {
    // App plugins run after module plugins, so posthog-js is initialised by now.
    if (!posthog.__loaded) return;

    const isDuplicate = createExceptionDeduper();

    posthog.set_config({
      before_send: (event) => {
        if (event?.event !== '$exception') return event;

        const signature = exceptionSignature(event.properties);
        if (!signature) return event;

        return isDuplicate(signature, Date.now()) ? null : event;
      },
    });
  },
});
