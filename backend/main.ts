import type { Server } from 'node:http';
import { buildApplication } from '@config/application';
import { config } from '@config/config';
import { getAppEnvironment } from '@config/environment';
import { runInitializers, runShutdownInitializers } from '@config/initializers';
import type { RuntimeContext } from '@config/initializers/types';
import { logger } from '@config/log';
import { initSentry } from '@config/sentry';

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startServer(context: RuntimeContext, port: number): Promise<Server> {
  return await new Promise<Server>((resolve, reject) => {
    const server = context.app.listen(port, () => resolve(server));
    server.on('error', reject);
  });
}

async function startRuntime(): Promise<void> {
  // Sentry must be initialized before building the Express app so that
  // setupExpressErrorHandler (called inside buildApplication) sees an active SDK.
  initSentry();

  const app = buildApplication();
  const context: RuntimeContext = {
    app,
    server: null,
  };

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, 'Received shutdown signal, shutting down gracefully');

    try {
      if (context.server) {
        await closeServer(context.server);
      }
      await runShutdownInitializers(context);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error(error, 'Error during shutdown');
      process.exit(1);
    }
  };

  try {
    await runInitializers(context);

    const environment = getAppEnvironment(config.ENVIRONMENT);

    logger.info('===================================');
    logger.info(`Current environment: [${environment}]`);

    context.server = await startServer(context, config.PORT);
    logger.info(`API listening on port ${config.PORT}`);

    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
  } catch (error) {
    logger.error(error, 'Unable to start application runtime');

    try {
      await runShutdownInitializers(context);
    } catch (shutdownError) {
      logger.error(shutdownError, 'Error while rolling back failed startup');
    }

    process.exit(1);
  }
}

void startRuntime();
