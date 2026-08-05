import { createHash } from 'crypto';
import { ApiKeyKind, ApiPermission, User } from '@app/models';
import { Cache, createCacheNamespace } from '@lib/cache';

const USER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const USER_CACHE_MAX_ENTRIES = 10_000;
const API_KEY_CACHE_MAX_ENTRIES = 10_000;
const AUTH_USER_CACHE = createCacheNamespace('authUser', USER_CACHE_MAX_ENTRIES);
const AUTH_API_KEY_CACHE = createCacheNamespace('authApiKey', API_KEY_CACHE_MAX_ENTRIES);

/**
 * Keys the API key cache by digest so plaintext keys never sit in a long-lived
 * map (and never leak into a heap dump or debugger inspection of the cache).
 */
function apiKeyCacheKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function getCachedUser(userId: number): User | null {
  return Cache.get<User>(AUTH_USER_CACHE, String(userId));
}

export function setCachedUser(user: User): void {
  Cache.set(AUTH_USER_CACHE, String(user.id), user, USER_CACHE_TTL_MS);
}

export function invalidateUserCache(userId: number): void {
  Cache.delete(AUTH_USER_CACHE, String(userId));
}

interface ApiKeyCacheEntry {
  userId: number;
  apiKeyId: string | undefined;
  apiKeyKind: ApiKeyKind;
  permissions: ApiPermission[];
}

export function getCachedApiKey(key: string): ApiKeyCacheEntry | null {
  return Cache.get<ApiKeyCacheEntry>(AUTH_API_KEY_CACHE, apiKeyCacheKey(key));
}

export function setCachedApiKey(key: string, entry: ApiKeyCacheEntry): void {
  Cache.set(AUTH_API_KEY_CACHE, apiKeyCacheKey(key), entry, API_KEY_CACHE_TTL_MS);
}

export function invalidateApiKeyCacheForUser(userId: number): void {
  Cache.deleteWhere<ApiKeyCacheEntry>(AUTH_API_KEY_CACHE, (_key, entry) => entry.userId === userId);
}
