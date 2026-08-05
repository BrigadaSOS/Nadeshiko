import { defineStore } from 'pinia';
import { handleApiError } from '~/utils/apiError';

// The /v1/auth/* API-key endpoints are served by better-auth and are not part of the
// OpenAPI spec, so the SDK has no generated types for them. These local shapes stand in
// until those routes are contracted (see phase 2 "Contract" work).
interface ApiResponse {
  status: number;
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

export const apiStore = defineStore('api', {
  actions: {
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
      } catch (error) {
        // DeveloperModule branches on `status` to render its inline error banner.
        handleApiError('api-keys:deactivate-failed', error, { toastKey: false });
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
      } catch (error) {
        // DeveloperModule branches on `status` to render its inline error banner.
        handleApiError('api-keys:rename-failed', error, { toastKey: false });
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
      } catch (error) {
        // DeveloperModule branches on `status` to render its inline error banner.
        handleApiError('api-keys:create-failed', error, { toastKey: false });
        return { status: 500 };
      }
    },
  },
});
