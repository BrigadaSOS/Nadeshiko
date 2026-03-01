import { logger } from '@config/log';
import { authInitializer } from './auth';
import { databaseInitializer } from './database';
import { mediaAuditsInitializer } from './mediaAudits';
import { sentryInitializer } from './sentry';
import { telemetryInitializer } from './telemetry';
import type { RuntimeContext, RuntimeInitializer } from './types';
import { workersInitializer } from './workers';

const initializers: RuntimeInitializer[] = [
  sentryInitializer,
  telemetryInitializer,
  authInitializer,
  databaseInitializer,
  workersInitializer,
  mediaAuditsInitializer,
];

export async function runInitializers(context: RuntimeContext): Promise<void> {
  for (const initializer of initializers) {
    logger.info({ initializer: initializer.name }, 'Initializing runtime component');
    await initializer.initialize(context);
  }
}

export async function runShutdownInitializers(context: RuntimeContext): Promise<void> {
  for (const initializer of [...initializers].reverse()) {
    if (!initializer.shutdown) {
      continue;
    }

    logger.info({ initializer: initializer.name }, 'Shutting down runtime component');
    await initializer.shutdown(context);
  }
}
