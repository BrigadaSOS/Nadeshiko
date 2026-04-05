export const BOT_CONFIG = {
  token: process.env.DISCORD_BOT_TOKEN ?? '',
  apiBaseUrl: process.env.NADESHIKO_API_URL ?? 'http://localhost:5000',
  apiKey: process.env.DISCORD_API_KEY_MASTER ?? '',
  frontendUrl: process.env.NADESHIKO_FRONTEND_URL ?? 'https://nadeshiko.co',
  embedColor: 0x8b5cf6,
  maxSearchResults: 20,
} as const;

export function getApplicationId(): string {
  const tokenParts = BOT_CONFIG.token.split('.');
  return Buffer.from(tokenParts[0], 'base64').toString();
}
