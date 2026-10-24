import type { CreateUserApiKey } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { InsufficientPermissionsError, InternalServerError, InvalidRequestError } from '@app/errors';
import { ApiPermission, Tier } from '@app/models';
import { auth, BETTER_AUTH_API_PERMISSION_RESOURCE, resolveGrantableApiPermissions } from '@config/auth';
import { captureApiKeyCreated } from '@app/services/analytics/posthog';

/** `auth.api` loses the plugin generic under `BetterAuthOptions`; the local cast exposes the plugin method, and the
 * runtime guard verifies it exists. */
type CreateApiKey = (args: {
  body: {
    name: string;
    userId: string;
    permissions: Record<string, string[]>;
    rateLimitMax?: number;
    rateLimitTimeWindow?: number;
  };
}) => Promise<{ id: string; name: string | null; key: string; createdAt: string | Date } | null>;

/** This trusted server call chooses scopes because the Better Auth route rejects client permissions; `assertUser`
 * and every check below are therefore load-bearing. */
export const createUserApiKey: CreateUserApiKey = async ({ body }, respond, req) => {
  const user = assertUser(req);

  // A key outlives the impersonation session that minted it, so it would hand the admin lasting access as this user.
  if (req.auth?.impersonatedBy) {
    throw new InsufficientPermissionsError('API keys cannot be created while impersonating a user.');
  }

  const name = body.name.trim();
  if (name.length === 0) {
    throw new InvalidRequestError('API key name cannot be blank.');
  }

  const requested = [...new Set(body.scopes)] as ApiPermission[];
  if (requested.length !== body.scopes.length) {
    throw new InvalidRequestError('Duplicate scopes in request.');
  }

  // `enforceApiKeyScope` is the sole gate for key-authenticated writes; do not issue a scope above the role-derived
  // ceiling.
  const grantable = new Set(await resolveGrantableApiPermissions(user.id));
  const refused = requested.filter((scope) => !grantable.has(scope));
  if (refused.length > 0) {
    throw new InsufficientPermissionsError(`Not permitted to grant the following scopes: ${refused.join(', ')}.`);
  }

  const createApiKey = (auth.api as { createApiKey?: CreateApiKey }).createApiKey;
  if (typeof createApiKey !== 'function') {
    throw new InternalServerError('API key creation is not configured.');
  }

  // Stamp rate limits when creating a key; existing keys are deliberately not restamped when a tier changes, so
  // integrations keep their issued limits.
  const tier = user.tierId ? await Tier.findOne({ where: { id: user.tierId } }) : null;

  const created = await createApiKey({
    body: {
      name,
      userId: String(user.id),
      permissions: { [BETTER_AUTH_API_PERMISSION_RESOURCE]: requested },
      ...(tier?.rateLimitMax != null ? { rateLimitMax: tier.rateLimitMax } : {}),
      ...(tier?.rateLimitWindowMs != null ? { rateLimitTimeWindow: tier.rateLimitWindowMs } : {}),
    },
  });

  // Key plaintext is returned only once; fail loudly if the plugin omits it, since the stored hash cannot recover it.
  if (!created?.key) {
    throw new InternalServerError('API key was created without a returnable secret.');
  }

  // Capture only successfully returned keys; analytics failures must never delay or fail key issuance.
  captureApiKeyCreated({ userId: user.id, scopes: requested });

  return respond.with201().body({
    id: created.id,
    name: created.name ?? name,
    key: created.key,
    scopes: requested,
    createdAt: new Date(created.createdAt).toISOString(),
  });
};
