import { ApiKeyKind, ApiPermission, User } from '@app/models';
import { Cache, createCacheNamespace } from '@lib/cache';

const USER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const AUTH_USER_CACHE = createCacheNamespace('authUser');
const AUTH_API_KEY_CACHE = createCacheNamespace('authApiKey');

export function getCachedUser(userId: number): User | null {
  return Cache.get<User>(AUTH_USER_CACHE, String(userId));
}

export function setCachedUser(user: User): void {
  Cache.set(AUTH_USER_CACHE, String(user.id), user, USER_CACHE_TTL_MS);
}

export function invalidateUserCache(userId: number): void {
  Cache.delete(AUTH_USER_CACHE, String(userId));
}

export interface ApiKeyCacheEntry {
  userId: number;
  apiKeyId: string | undefined;
  apiKeyKind: ApiKeyKind;
  permissions: ApiPermission[];
}

export function getCachedApiKey(key: string): ApiKeyCacheEntry | null {
  return Cache.get<ApiKeyCacheEntry>(AUTH_API_KEY_CACHE, key);
}

export function setCachedApiKey(key: string, entry: ApiKeyCacheEntry): void {
  Cache.set(AUTH_API_KEY_CACHE, key, entry, API_KEY_CACHE_TTL_MS);
}

export function invalidateApiKeyCacheForUser(userId: number): void {
  Cache.deleteWhere<ApiKeyCacheEntry>(AUTH_API_KEY_CACHE, (_key, entry) => entry.userId === userId);
}
