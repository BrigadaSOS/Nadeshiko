import { defineStore } from 'pinia';
import { handleApiError } from '~/utils/apiError';

// These are view models, not stand-ins for a missing contract: `/v1/auth/api-key/*`
// IS contracted now (backend/bin/generateAuthSpec.ts feeds the SDK), and the wire
// shape differs from what this screen renders -- `isActive` comes from `enabled`,
// `hint` from `start ?? prefix`, and `permissions` is flattened from an object.
//
// `normalizeApiKey` deliberately reads from `unknown` rather than the generated
// type. better-auth's OpenAPI output is derived from its plugins and does not
// always match what the server sends (better-auth#8122), so this is the boundary
// where an optimistic contract meets a real response.
interface ApiResponse {
  status: number;
}

interface ApiKeyPermission {
  id: number;
  name: string;
}

/**
 * Scopes a reader may put on their own key, and the presets the modal offers.
 *
 * The backend enforces its own ceiling on these -- this list is what the UI
 * offers, not what makes the request safe. It deliberately omits the
 * corpus-write scopes: those need an admin role, and an admin who wants one can
 * ask for it through the API.
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

/**
 * Everything a third-party search or dictionary tool needs, and nothing that
 * touches the reader's account. This is the preset to steer people toward: a
 * key handed to someone else's app is a bearer credential in code you do not
 * control, so the useful question is not "do I trust them" but "what is the
 * worst this key can do if it leaks".
 */
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
 * Runs an API-key mutation and reports it as a status, never a throw.
 *
 * DeveloperSettings branches on `status` to render its inline error banner, so
 * every one of these actions has to resolve rather than reject. The three of them
 * differed only in the call and the error key.
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
     * Creates a key with an explicit scope list.
     *
     * Not `authApiKeyCreate`, which this used to call: better-auth treats a
     * permission list as a server-only field and rejects any request carrying
     * one, so keys made through it always get the default scopes. Anything the
     * reader is going to paste into someone else's app needs to be narrower
     * than that, which is what `/v1/user/api-keys` exists to allow.
     */
    createApiKeyGeneral(nameApiKey: string, scopes: ApiKeyScope[]): Promise<ApiKeyActionResponse> {
      return asStatus('api-keys:create-failed', () => useNadeshikoSdk().createUserApiKey({ name: nameApiKey, scopes }));
    },
  },
});
