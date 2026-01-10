import { defineStore } from 'pinia';
import { useRuntimeConfig } from '#app';

interface ApiResponse {
  status: number;
  [key: string]: any;
}

interface QuotaInfo {
  quotaUsed: number;
  quotaLimit: number;
  quotaRemaining: number;
}

interface ApiKeyListItem {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  hint: string;
  permissions: Array<{ id: number; name: string }>;
}

function normalizePermissionList(permissions: unknown): Array<{ id: number; name: string }> {
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

function normalizeApiKey(key: any): ApiKeyListItem {
  return {
    id: String(key.id),
    name: key.name ?? '',
    isActive: key.enabled !== false,
    createdAt: key.createdAt ?? new Date().toISOString(),
    hint: key.start ?? key.prefix ?? '',
    permissions: normalizePermissionList(key.permissions),
  };
}

export const apiStore = defineStore('api', {
  actions: {
    async getApiKeysByUser(): Promise<ApiResponse | void> {
      const config = useRuntimeConfig();

      try {
        const [keysResponse, quotaResponse] = await Promise.all([
          fetch(`${config.public.backendUrl}/api/auth/api-key/list`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
          }),
          fetch(`${config.public.backendUrl}/v1/user/quota`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
          }),
        ]);

        const data = await keysResponse.json();

        if (!keysResponse.ok) {
          return {
            status: keysResponse.status,
            ...data,
          };
        }

        const keys = Array.isArray(data) ? data.map(normalizeApiKey) : [];
        let quota: QuotaInfo = {
          quotaUsed: 0,
          quotaLimit: 2500,
          quotaRemaining: 2500,
        };

        if (quotaResponse.ok) {
          const quotaData = await quotaResponse.json();
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
      }
    },

    async deactivateApiKey(apiKeyId: string): Promise<ApiResponse | void> {
      const config = useRuntimeConfig();

      try {
        const response = await fetch(`${config.public.backendUrl}/api/auth/api-key/update`, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            keyId: apiKeyId,
            enabled: false,
          }),
          credentials: 'include',
        });

        const data = await response.json();

        return {
          status: response.status,
          ...data,
        };
      } catch (error) {
        console.error(error);
      }
    },

    async createApiKeyGeneral(nameApiKey: string): Promise<ApiResponse | void> {
      const config = useRuntimeConfig();

      try {
        const response = await fetch(`${config.public.backendUrl}/api/auth/api-key/create`, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            name: nameApiKey,
          }),
        });

        const data = await response.json();

        return {
          status: response.status,
          ...data,
        };
      } catch (error) {
        console.error(error);
      }
    },
  },
});
