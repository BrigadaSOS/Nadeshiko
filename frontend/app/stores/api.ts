import { defineStore } from 'pinia';
import { authApiRequest } from '~/utils/authApi';

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

function normalizePermissionList(permissions: unknown): ApiKeyPermission[] {
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

function normalizeApiKey(key: unknown): ApiKeyListItem {
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

function asObject(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

export const apiStore = defineStore('api', {
  actions: {
    async getApiKeysByUser(): Promise<ApiKeysByUserResponse> {
      try {
        const [keysResponse, quotaResponse] = await Promise.all([
          authApiRequest<unknown[]>('/api/auth/api-key/list', {
            method: 'GET',
          }),
          authApiRequest<Record<string, unknown>>('/v1/user/quota', {
            method: 'GET',
          }),
        ]);

        const data = keysResponse.data;

        if (!keysResponse.ok) {
          return {
            status: keysResponse.status,
            keys: [],
            quota: {
              quotaUsed: 0,
              quotaLimit: 2500,
              quotaRemaining: 2500,
            },
          };
        }

        const keys = Array.isArray(data) ? data.map(normalizeApiKey) : [];
        let quota: QuotaInfo = {
          quotaUsed: 0,
          quotaLimit: 2500,
          quotaRemaining: 2500,
        };

        if (quotaResponse.ok) {
          const quotaData = asObject(quotaResponse.data);
          quota = {
            quotaUsed: Number(quotaData.quotaUsed ?? 0),
            quotaLimit: Number(quotaData.quotaLimit ?? 2500),
            quotaRemaining: Number(quotaData.quotaRemaining ?? 0),
          };
        }

        return {
          status: keysResponse.status,
          keys,
          quota,
        };
      } catch (error) {
        console.error(error);
        return {
          status: 500,
          keys: [],
          quota: {
            quotaUsed: 0,
            quotaLimit: 2500,
            quotaRemaining: 2500,
          },
        };
      }
    },

    async deactivateApiKey(apiKeyId: string): Promise<ApiResponse> {
      try {
        const response = await authApiRequest('/api/auth/api-key/update', {
          method: 'POST',
          body: {
            keyId: apiKeyId,
            enabled: false,
          },
        });

        return {
          status: response.status,
          ...asObject(response.data),
        };
      } catch (error) {
        console.error(error);
        return { status: 500 };
      }
    },

    async createApiKeyGeneral(nameApiKey: string): Promise<ApiKeyActionResponse> {
      try {
        const response = await authApiRequest('/api/auth/api-key/create', {
          method: 'POST',
          body: {
            name: nameApiKey,
          },
        });

        return {
          status: response.status,
          ...asObject(response.data),
        };
      } catch (error) {
        console.error(error);
        return { status: 500 };
      }
    },
  },
});
