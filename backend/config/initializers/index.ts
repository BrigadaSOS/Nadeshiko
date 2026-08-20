import { logger } from '@config/log';
import { analyticsInitializer } from './analytics';
import { authInitializer } from './auth';
import { databaseInitializer } from './database';
import { emailInitializer } from './email';
import { masterApiKeyInitializer } from './masterApiKey';
import { telemetryInitializer } from './telemetry';
import type { RuntimeContext, RuntimeInitializer } from './types';
import { workersInitializer } from './workers';

const initializers: RuntimeInitializer[] = [
  telemetryInitializer,
  // Early, so that shutdown -- which runs this list in reverse -- flushes the
  // analytics queue last, after everything that might still be capturing has
  // stopped.
  analyticsInitializer,
  authInitializer,
  databaseInitializer,
  // After the database: the suppression gauge it registers reads a table.
  emailInitializer,
  masterApiKeyInitializer,
  workersInitializer,
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
