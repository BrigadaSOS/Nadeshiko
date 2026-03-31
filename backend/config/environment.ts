import '@config/boot';
import { config } from '@config/config';

export const APP_ENVIRONMENT = {
  LOCAL: 'local',
  DEV: 'development',
  PROD: 'production',
} as const;

export type AppEnvironment = (typeof APP_ENVIRONMENT)[keyof typeof APP_ENVIRONMENT];

function normalizeEnvironment(rawValue: string | undefined): string {
  return rawValue?.trim().toLowerCase() || '';
}

export function getAppEnvironment(rawValue: string | undefined): AppEnvironment {
  const normalized = normalizeEnvironment(rawValue);

  if (
    normalized === APP_ENVIRONMENT.LOCAL ||
    normalized === APP_ENVIRONMENT.DEV ||
    normalized === APP_ENVIRONMENT.PROD
  ) {
    return normalized;
  }

  throw new Error(`Invalid ENVIRONMENT "${rawValue}". Expected one of: local, development, production.`);
}

export function isLocalEnvironment(rawValue: string = config.ENVIRONMENT): boolean {
  return getAppEnvironment(rawValue) === APP_ENVIRONMENT.LOCAL;
}

export function isDevEnvironment(rawValue: string = config.ENVIRONMENT): boolean {
  return getAppEnvironment(rawValue) === APP_ENVIRONMENT.DEV;
}

export function isProdEnvironment(rawValue: string = config.ENVIRONMENT): boolean {
  return getAppEnvironment(rawValue) === APP_ENVIRONMENT.PROD;
}
