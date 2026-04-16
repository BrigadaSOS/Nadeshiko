import { defineStore } from 'pinia';

interface ApiResponse {
  status: number;
}

interface QuotaInfo {
  quotaUsed: number;
  quotaLimit: number;
  quotaRemaining: number;
}

interface ApiKeyPermission {
  id: number;
  name: string;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  hint: string;
  permissions: ApiKeyPermission[];
}

export interface ApiKeysByUserResponse extends ApiResponse {
  keys: ApiKeyListItem[];
  quota: QuotaInfo;
}

interface ApiKeyActionResponse extends ApiResponse {
  key?: string;
}

export function normalizePermissionList(permissions: unknown): ApiKeyPermission[] {
  if (!permissions || typeof permissions !== 'object') {
    return [];
  }

  const permissionNames = Array.from(
    new Set(
      Object.values(permissions as Record<string, unknown>)
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .filter((value): value is string => typeof value === 'string'),
    ),
  );

  return permissionNames.map((name, index) => ({
    id: index + 1,
    name,
  }));
}

export function normalizeApiKey(key: unknown): ApiKeyListItem {
  const normalizedKey = asObject(key);

  return {
    id: String(normalizedKey.id ?? ''),
    name: String(normalizedKey.name ?? ''),
    isActive: normalizedKey.enabled !== false,
    createdAt: String(normalizedKey.createdAt ?? new Date().toISOString()),
    hint: String(normalizedKey.start ?? normalizedKey.prefix ?? ''),
    permissions: normalizePermissionList(normalizedKey.permissions),
  };
}

export function asObject(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

async function fetchMe(): Promise<Record<string, unknown> | null> {
  return $fetch<Record<string, unknown>>('/v1/user/me', { method: 'GET', credentials: 'include' }).catch(() => null);
}

export const apiStore = defineStore('api', {
  actions: {
    async getApiKeysByUser(): Promise<ApiKeysByUserResponse> {
      try {
        const [keysRaw, meResult] = await Promise.all([
          $fetch<unknown[]>('/v1/auth/api-key/list', { method: 'GET', credentials: 'include' }).catch(() => []),
          fetchMe(),
        ]);

        const keys = (Array.isArray(keysRaw) ? keysRaw : []).map(normalizeApiKey);
        const quotaData = asObject(meResult?.quota);
        const quota: QuotaInfo = {
          quotaUsed: Number(quotaData?.used ?? 0),
          quotaLimit: Number(quotaData?.limit ?? 5000),
          quotaRemaining: Number(quotaData?.remaining ?? 0),
        };

        return { status: 200, keys, quota };
      } catch {
        return {
          status: 500,
          keys: [],
          quota: {
            quotaUsed: 0,
            quotaLimit: 5000,
            quotaRemaining: 5000,
          },
        };
      }
    },

    async deactivateApiKey(apiKeyId: string): Promise<ApiResponse> {
      try {
        const data = await $fetch('/v1/auth/api-key/update', {
          method: 'POST',
          credentials: 'include',
          body: {
            keyId: apiKeyId,
            enabled: false,
          },
        });

        return { status: 200, ...asObject(data) };
      } catch {
        return { status: 500 };
      }
    },

    async renameApiKey(apiKeyId: string, newName: string): Promise<ApiResponse> {
      try {
        const data = await $fetch('/v1/auth/api-key/update', {
          method: 'POST',
          credentials: 'include',
          body: {
            keyId: apiKeyId,
            name: newName,
          },
        });

        return { status: 200, ...asObject(data) };
      } catch {
        return { status: 500 };
      }
    },

    async createApiKeyGeneral(nameApiKey: string): Promise<ApiKeyActionResponse> {
      try {
        const data = await $fetch('/v1/auth/api-key/create', {
          method: 'POST',
          credentials: 'include',
          body: {
            name: nameApiKey,
          },
        });

        return { status: 200, ...asObject(data) };
      } catch {
        return { status: 500 };
      }
    },
  },
});
