import type { CreateUserApiKey } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { InsufficientPermissionsError, InternalServerError, InvalidRequestError } from '@app/errors';
import { ApiPermission } from '@app/models';
import { auth, BETTER_AUTH_API_PERMISSION_RESOURCE, resolveGrantableApiPermissions } from '@config/auth';

/**
 * Declared locally and reached for through a cast, the same way
 * `authentication.ts` reaches `verifyApiKey`: `buildAuthOptions` is annotated
 * `BetterAuthOptions`, which erases the plugin generic, so `auth.api` types as
 * the base endpoints only and no plugin method is visible on it. The runtime
 * guard below is what actually establishes the method exists.
 */
type CreateApiKey = (args: {
  body: { name: string; userId: string; permissions: Record<string, string[]> };
}) => Promise<{ id: string; name: string | null; key: string; createdAt: string | Date } | null>;

/**
 * Creates an API key carrying exactly the scopes the owner chose.
 *
 * WHY THIS EXISTS AT ALL, given better-auth already serves
 * `/v1/auth/api-key/create`. That endpoint cannot take a scope list: the plugin
 * classifies `permissions` as a server-only property and answers any HTTP
 * request carrying one with `SERVER_ONLY_PROPERTY` (see its `index.mjs`, the
 * `isClientRequest` guard on the create handler). That is a good rule -- it is
 * exactly what stops a reader granting themselves `ADD_MEDIA` and rewriting the
 * shared corpus -- and it means scope selection has to come from a route that
 * decides the list server-side, which is this one.
 *
 * `auth.api.createApiKey` is therefore called with NO `headers` and NO
 * `request`, so the plugin treats it as a trusted server call and accepts the
 * permission list. That also means the plugin does no auth of its own here:
 * every check below is load-bearing, and `userId` comes from the session via
 * `assertUser` rather than from the body, which a caller controls.
 */
export const createUserApiKey: CreateUserApiKey = async ({ body }, respond, req) => {
  const user = assertUser(req);

  const name = body.name.trim();
  if (name.length === 0) {
    throw new InvalidRequestError('API key name cannot be blank.');
  }

  const requested = [...new Set(body.scopes)] as ApiPermission[];
  if (requested.length !== body.scopes.length) {
    throw new InvalidRequestError('Duplicate scopes in request.');
  }

  // The ceiling is role-derived, and it is the only thing standing between a
  // normal account and the corpus-write scopes: `enforceApiKeyScope` is the
  // sole gate on a key-authenticated request, because `enforceSessionAdmin`
  // waves API-key traffic straight through. A key that should not have
  // ADD_MEDIA must therefore never be issued with it -- there is no second
  // check downstream that would catch it.
  const grantable = new Set(await resolveGrantableApiPermissions(user.id));
  const refused = requested.filter((scope) => !grantable.has(scope));
  if (refused.length > 0) {
    throw new InsufficientPermissionsError(`Not permitted to grant the following scopes: ${refused.join(', ')}.`);
  }

  const createApiKey = (auth.api as { createApiKey?: CreateApiKey }).createApiKey;
  if (typeof createApiKey !== 'function') {
    throw new InternalServerError('API key creation is not configured.');
  }

  const created = await createApiKey({
    body: {
      name,
      userId: String(user.id),
      permissions: { [BETTER_AUTH_API_PERMISSION_RESOURCE]: requested },
    },
  });

  // The plaintext key exists only in this response -- the row stores a hash --
  // so a shape change that dropped it would be unrecoverable for the caller
  // rather than merely wrong. Fail loudly instead of returning a key-shaped
  // object with nothing in it.
  if (!created?.key) {
    throw new InternalServerError('API key was created without a returnable secret.');
  }

  return respond.with201().body({
    id: created.id,
    name: created.name ?? name,
    key: created.key,
    scopes: requested,
    createdAt: new Date(created.createdAt).toISOString(),
  });
};
