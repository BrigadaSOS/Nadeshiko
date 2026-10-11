import { logger } from '@config/log';

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

/** Always writes fatal CLI errors to stderr because `.env.test` can silence the structured logger and otherwise make
 * a failed setup look successful. */
export function reportFatalError(message: string, error: unknown): void {
  logger.error(error, message);

  if (logger.isLevelEnabled('error')) return;

  console.error(`${message}: ${describe(error)}`);

  const cause = error instanceof Error ? error.cause : undefined;
  if (cause !== undefined) {
    console.error(`Caused by: ${describe(cause)}`);
  }
}
