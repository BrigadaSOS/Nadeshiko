export const APP_ENVIRONMENT = {
  LOCAL: 'local',
  DEV: 'dev',
  PROD: 'prod',
} as const;

export type AppEnvironment = (typeof APP_ENVIRONMENT)[keyof typeof APP_ENVIRONMENT];

const LEGACY_ENVIRONMENT_ALIASES: Record<string, AppEnvironment> = {
  development: APP_ENVIRONMENT.DEV,
  production: APP_ENVIRONMENT.PROD,
  testing: APP_ENVIRONMENT.LOCAL,
};

function normalizeEnvironment(rawValue: string | undefined): string {
  return rawValue?.trim().toLowerCase() || '';
}

export function getAppEnvironment(rawValue: string | undefined = process.env.ENVIRONMENT): AppEnvironment {
  const normalized = normalizeEnvironment(rawValue);

  if (
    normalized === APP_ENVIRONMENT.LOCAL ||
    normalized === APP_ENVIRONMENT.DEV ||
    normalized === APP_ENVIRONMENT.PROD
  ) {
    return normalized;
  }

  if (normalized in LEGACY_ENVIRONMENT_ALIASES) {
    return LEGACY_ENVIRONMENT_ALIASES[normalized];
  }

  return APP_ENVIRONMENT.LOCAL;
}

export function isLocalEnvironment(rawValue?: string): boolean {
  return getAppEnvironment(rawValue) === APP_ENVIRONMENT.LOCAL;
}

export function isDevEnvironment(rawValue?: string): boolean {
  return getAppEnvironment(rawValue) === APP_ENVIRONMENT.DEV;
}

export function isProdEnvironment(rawValue?: string): boolean {
  return getAppEnvironment(rawValue) === APP_ENVIRONMENT.PROD;
}
