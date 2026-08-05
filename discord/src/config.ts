export const BOT_CONFIG = {
  token: process.env.DISCORD_BOT_TOKEN ?? '',
  apiBaseUrl: process.env.NADESHIKO_API_URL ?? 'http://localhost:5000',
  apiKey: process.env.DISCORD_API_KEY_MASTER ?? '',
  frontendUrl: process.env.NADESHIKO_FRONTEND_URL ?? 'https://nadeshiko.co',
  embedColor: 0x8b5cf6,
  maxSearchResults: 20,
} as const;

/**
 * Throws when the bot is missing environment it cannot run without.
 *
 * Secrets are always required. The URLs fall back to dev-friendly defaults, so
 * they are only enforced in production -- there an unset NADESHIKO_API_URL would
 * silently point the bot at localhost instead of failing.
 */
export function validateConfig(): void {
  const missing: string[] = [];
  if (!BOT_CONFIG.token) missing.push('DISCORD_BOT_TOKEN');
  if (!BOT_CONFIG.apiKey) missing.push('DISCORD_API_KEY_MASTER');

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.NADESHIKO_API_URL) missing.push('NADESHIKO_API_URL');
    if (!process.env.NADESHIKO_FRONTEND_URL) missing.push('NADESHIKO_FRONTEND_URL');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  for (const [name, value] of [
    ['NADESHIKO_API_URL', BOT_CONFIG.apiBaseUrl],
    ['NADESHIKO_FRONTEND_URL', BOT_CONFIG.frontendUrl],
  ] as const) {
    if (!URL.canParse(value)) {
      throw new Error(`${name} is not a valid URL: ${value}`);
    }
  }
}

export function getApplicationId(): string {
  const tokenParts = BOT_CONFIG.token.split('.');
  const applicationId = Buffer.from(tokenParts[0], 'base64').toString();
  if (!applicationId) {
    throw new Error('DISCORD_BOT_TOKEN is malformed: cannot derive the application ID from it');
  }
  return applicationId;
}
