import { logger } from '@config/log';

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

/**
 * CLI entrypoints inherit LOG_LEVEL from whichever env file loaded, and
 * `.env.test` sets it to `silent` -- which turned a failed `npm run test:setup`
 * into a command that printed nothing and looked like a successful no-op. A
 * fatal error always reaches stderr, whatever level is configured.
 */
export function reportFatalError(message: string, error: unknown): void {
  logger.error(error, message);

  if (logger.isLevelEnabled('error')) return;

  console.error(`${message}: ${describe(error)}`);

  const cause = error instanceof Error ? error.cause : undefined;
  if (cause !== undefined) {
    console.error(`Caused by: ${describe(cause)}`);
  }
}
