// First, and before anything that reads process.env. `boot` loads .env and
// installs the uncaught-exception and unhandled-rejection handlers, and
// `@config/config` validates the whole environment at module load, so importing
// it first (as bin/db.ts, bin/es.ts and bin/dbBootstrap.ts already do) is what
// makes that validation see the file. Without it `npm run dev` dies with a
// ZodError naming every variable, and the server runs with no fatal handlers.
import '@config/boot';
import http, { type Server } from 'node:http';
import { buildApplication } from '@config/application';
import { config } from '@config/config';
import { getAppEnvironment } from '@config/environment';
import { runInitializers, runShutdownInitializers } from '@config/initializers';
import type { RuntimeContext } from '@config/initializers/types';
import { logger } from '@config/log';

// Match kamal-proxy's ∞ timeout to prevent half-open connections
// 120s gives enough buffer for slow clients while preventing connection accumulation
const SERVER_KEEP_ALIVE_TIMEOUT_MS = 120000;

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
    const server = http.createServer(context.app);
    server.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS;
    server.listen(port, () => resolve(server));
    server.on('error', reject);
  });
}

async function startRuntime(): Promise<void> {
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

    // Without the shared secret the per-IP limiter cannot tell frontend traffic
    // apart from the public internet. Internal callers reach us through
    // kamal-proxy and carry no X-Forwarded-For of their own, so `req.ip` falls
    // back to the proxy's address and every SSR render, proxied call and bot
    // request competes for ONE bucket -- a site-wide ceiling in the low
    // hundreds per minute, whatever the traffic actually is.
    //
    // This refuses to boot rather than warning, which it used to do. A warning
    // is the wrong shape for this failure: nothing downstream degrades
    // visibly, the site simply acquires an invisible capacity cliff that only
    // shows up as an outage under load, months after the deploy that caused
    // it. The frontend has always refused to start without its half of the
    // pair (frontend/server/plugins/01-env-check.ts); this is the other half.
    //
    // Safe to fail hard: Kamal health-checks the new container before shifting
    // traffic, so a missing secret fails the deploy instead of the site.
    if (!config.INTERNAL_PROXY_SECRET && config.ENVIRONMENT !== 'local') {
      throw new Error(
        'INTERNAL_PROXY_SECRET is not set: the per-IP rate limiter cannot recognise our own frontend, ' +
          'so all internal traffic would share a single bucket. Set it to the same value as the ' +
          "frontend's NUXT_INTERNAL_PROXY_SECRET.",
      );
    }

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
