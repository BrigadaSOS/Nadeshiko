import type { Category } from '@brigadasos/nadeshiko-sdk';

/**
 * Maps URL-friendly category slugs to API category values.
 */
export const CATEGORY_API_MAPPING: Record<string, Category> = {
  anime: 'ANIME',
  liveaction: 'JDRAMA',
} as const;
