export const BOT_CONFIG = {
  token: process.env.DISCORD_BOT_TOKEN ?? '',
  apiBaseUrl: process.env.NADESHIKO_API_URL ?? 'http://localhost:5000',
  apiKey: process.env.DISCORD_API_KEY_MASTER ?? '',
  frontendUrl: process.env.NADESHIKO_FRONTEND_URL ?? 'https://nadeshiko.co',
  embedColor: 0x8b5cf6,
  embedColorAnime: 0x8b5cf6,
  embedColorJdrama: 0xf59e0b,
  maxSearchResults: 5,
} as const;
