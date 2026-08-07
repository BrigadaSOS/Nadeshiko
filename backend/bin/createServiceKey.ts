import '@config/boot';
import { randomBytes } from 'crypto';
import { defaultKeyHasher } from '@better-auth/api-key';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { inferApiKeyKind } from '@app/middleware/authentication';
import { ApiKeyKind, ApiPermission, User, UserRoleType } from '@app/models';

/**
 * Mints a SERVICE API key for a machine caller.
 *
 * Why this exists rather than "just create a key in the UI": the developer page
 * issues USER keys, and the difference is not cosmetic. A SERVICE key is exempt
 * from the per-account quota and the per-IP rate limiter, and — since the
 * moderation work — it is also what stamps `actor=AGENT` on every segment
 * revision the caller writes. `inferApiKeyKind` decides that from
 * `metadata.keyType`, a field nothing in the UI sets.
 *
 * The failure mode of getting this wrong is silent and durable. A USER key
 * authenticates, passes authorisation, and edits succeed — but every revision is
 * filed as HUMAN, so `/v1/admin/agent-activity` stays empty and the spot-check
 * meant to catch a misbehaving agent has nothing to show. Nobody notices until
 * they go looking, which is exactly when they needed it.
 *
 * Why a direct INSERT rather than `auth.api.createApiKey`
 * -------------------------------------------------------
 * The apiKey plugin runs with metadata disabled, so `createApiKey` rejects the
 * `keyType` field outright ("Metadata is disabled"). That is not an oversight to
 * work around by enabling it: `/v1/auth/api-key/create` is a better-auth route
 * reachable by any signed-in user, and with metadata enabled any of them could
 * post `{metadata: {keyType: "service"}}` and mint themselves a key that skips
 * the quota and the rate limiter, and whose edits are attributed to the agent.
 *
 * So the key is written the same way `db/seeds.ts` writes the master key —
 * hashed with better-auth's own hasher and inserted directly — which keeps the
 * privileged field on a path that requires database access rather than a session.
 *
 * Usage:
 *   npm run create:service-key -- --user <id|email> --name roxy-moderation \
 *     --permissions READ_MEDIA,UPDATE_MEDIA
 *
 * The key is printed once and never again — only its hash is stored.
 */

/** Matches the plugin's `defaultPrefix`, so a key is recognisable on sight. */
const KEY_PREFIX = 'nade_';

/** better-auth stores permissions as resource -> actions; the resource is not read anywhere. */
const BETTER_AUTH_PERMISSION_RESOURCE = 'api';

type Args = {
  user: string;
  name: string;
  permissions: ApiPermission[];
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const user = get('--user');
  const name = get('--name');
  const rawPermissions = get('--permissions');

  if (!user || !name || !rawPermissions) {
    throw new Error(
      'Usage: --user <id|email> --name <label> --permissions <A,B>\n' +
        `Valid permissions: ${Object.values(ApiPermission).join(', ')}`,
    );
  }

  const permissions = rawPermissions
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  // An unrecognised permission would otherwise be dropped silently by
  // `flattenBetterAuthPermissions` at request time, producing a key that is
  // mysteriously missing one scope.
  const invalid = permissions.filter((p) => !Object.values(ApiPermission).includes(p as ApiPermission));
  if (invalid.length > 0) {
    throw new Error(`Unknown permission(s): ${invalid.join(', ')}\nValid: ${Object.values(ApiPermission).join(', ')}`);
  }

  return { user, name, permissions: permissions as ApiPermission[] };
}

/**
 * Mirrors `CORPUS_WRITE_PERMISSIONS` in `bin/generateRouteAuth.ts`: scopes that
 * mutate the shared media corpus rather than data the caller owns.
 */
const CORPUS_WRITE_PERMISSIONS = new Set<ApiPermission>([
  ApiPermission.ADD_MEDIA,
  ApiPermission.UPDATE_MEDIA,
  ApiPermission.REMOVE_MEDIA,
]);

async function resolveUser(identifier: string, permissions: ApiPermission[]): Promise<User> {
  const asId = Number(identifier);
  const user = Number.isInteger(asId)
    ? await User.findOne({ where: { id: asId } })
    : await User.findOne({ where: { email: identifier } });

  if (!user) {
    throw new Error(`No user matches '${identifier}'`);
  }

  // The key inherits this account's identity: every revision it writes records
  // this user id, and the activity feed shows this username. Point a shared agent
  // key at a personal account and the agent's edits look like that person's.
  if (!user.isActive) {
    throw new Error(`User ${user.id} is inactive; an inactive owner fails auth on every request`);
  }

  // Not a privilege boundary — permissions carry a key's authority, and the
  // owner's role is never consulted at request time (`enforceSessionAdmin`
  // returns early for API-key auth). This catches a mistyped `--user`: attaching
  // corpus-write scope to a reader's account does not escalate anything, but it
  // does file every subsequent agent edit under that person's name in the
  // activity feed, which is the one record meant to answer "who changed this".
  const corpusWrites = permissions.filter((p) => CORPUS_WRITE_PERMISSIONS.has(p));
  if (corpusWrites.length > 0 && user.role !== UserRoleType.ADMIN) {
    throw new Error(
      `Refusing to attach corpus-write scope (${corpusWrites.join(', ')}) to non-admin user ` +
        `${user.id} (${user.email}, role=${user.role}).\n` +
        'The key would work, but its edits would be attributed to that account. ' +
        'Point --user at an admin, or drop the corpus-write permissions.',
    );
  }

  return user;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await AppDataSource.initialize();

  try {
    const user = await resolveUser(args.user, args.permissions);

    // 32 bytes base64url — the same shape better-auth generates, and well past
    // what a brute force could reach.
    const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const hashedKey = await defaultKeyHasher(key);

    const permissions = JSON.stringify({ [BETTER_AUTH_PERMISSION_RESOURCE]: args.permissions });
    const metadata = JSON.stringify({ keyType: 'service', source: 'createServiceKey' });

    await AppDataSource.query(
      `
        INSERT INTO "apikey" (
          "name", "start", "prefix", "key", "referenceId", "configId",
          "enabled", "rateLimitEnabled", "metadata", "permissions",
          "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, 'default', true, false, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      [args.name, key.slice(0, 6), KEY_PREFIX, hashedKey, String(user.id), metadata, permissions],
    );

    // Read back through the same function the request path uses, rather than
    // trusting that what we wrote is what will be read.
    const [stored] = await AppDataSource.query(`SELECT "metadata" FROM "apikey" WHERE "key" = $1 LIMIT 1`, [hashedKey]);
    const kind = inferApiKeyKind(stored ?? {});
    if (kind !== ApiKeyKind.SERVICE) {
      throw new Error(
        `Key was written but reads back as ${kind}, not SERVICE. Do not use it — its edits ` +
          'would be recorded as human. Delete it and check how the metadata was stored.',
      );
    }

    logger.info({ name: args.name, userId: user.id, permissions: args.permissions, kind }, 'Service API key created');

    // stdout, not the logger: this is the one value the caller has to capture,
    // and it must not be interleaved with structured output or shipped to the
    // log collector.
    process.stdout.write(`\n${key}\n\n`);
    process.stdout.write('Store it now — only the hash is kept, so it cannot be shown again.\n');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  logger.error({ err: error }, 'Failed to create service API key');
  process.exitCode = 1;
});
