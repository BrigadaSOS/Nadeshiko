import { APP_ENVIRONMENT, getAppEnvironment } from '@config/environment';
import { config } from '@config/config';

const PROD_DESTRUCTIVE_FLAG = '--allow-prod-destructive';

export function ensureDestructiveAllowed(command: string, args: string[]): void {
  const environment = getAppEnvironment(config.ENVIRONMENT);

  if (environment !== APP_ENVIRONMENT.PROD) {
    return;
  }

  if (args.includes(PROD_DESTRUCTIVE_FLAG)) {
    return;
  }

  throw new Error(
    `Command '${command}' is destructive and blocked in prod. Re-run with ${PROD_DESTRUCTIVE_FLAG} to confirm.`,
  );
}
