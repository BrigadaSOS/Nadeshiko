import { defineStore } from 'pinia';
import { handleApiError } from '~/utils/apiError';

// These are UI models: enabled, start/prefix, and permissions need normalization. Read unknown
// at the boundary because better-auth's generated schema can differ from runtime responses
// (better-auth#8122).
interface ApiResponse {
  status: number;
}

interface ApiKeyPermission {
  id: number;
  name: string;
}

/**
 * UI-offered scopes, not a security boundary: the backend enforces its own ceiling. Admin
 * corpus-write scopes are API-only.
 */
export const API_KEY_SCOPES = [
  'READ_MEDIA',
  'READ_PROFILE',
  'WRITE_PROFILE',
  'READ_ACTIVITY',
  'WRITE_ACTIVITY',
  'READ_COLLECTIONS',
  'CREATE_COLLECTIONS',
  'UPDATE_COLLECTIONS',
  'DELETE_COLLECTIONS',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Limit third-party bearer keys to media reads so leaks cannot affect the reader's account. */
export const READ_ONLY_API_KEY_SCOPES: ApiKeyScope[] = ['READ_MEDIA'];

/** Everything a reader can grant -- what an unscoped key used to get. */
export const FULL_ACCOUNT_API_KEY_SCOPES: ApiKeyScope[] = [...API_KEY_SCOPES];

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

function asObject(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

/**
 * Resolve mutations as statuses rather than throwing: DeveloperSettings renders its own inline
 * error.
 */
async function asStatus<T>(errorKey: string, call: () => Promise<T>): Promise<ApiKeyActionResponse> {
  try {
    return { status: 200, ...asObject(await call()) };
  } catch (error) {
    handleApiError(errorKey, error, { toastKey: false });
    return { status: 500 };
  }
}

export const apiStore = defineStore('api', {
  actions: {
    deactivateApiKey(apiKeyId: string): Promise<ApiResponse> {
      return asStatus('api-keys:deactivate-failed', () =>
        useNadeshikoSdk().authApiKeyUpdate({ keyId: apiKeyId, enabled: false }),
      );
    },

    renameApiKey(apiKeyId: string, newName: string): Promise<ApiResponse> {
      return asStatus('api-keys:rename-failed', () =>
        useNadeshikoSdk().authApiKeyUpdate({ keyId: apiKeyId, name: newName }),
      );
    },

    /**
     * Use /v1/user/api-keys for explicit scopes; better-auth's create endpoint rejects
     * client-supplied permissions and otherwise grants its defaults.
     */
    createApiKeyGeneral(nameApiKey: string, scopes: ApiKeyScope[]): Promise<ApiKeyActionResponse> {
      return asStatus('api-keys:create-failed', () => useNadeshikoSdk().createUserApiKey({ name: nameApiKey, scopes }));
    },
  },
});
