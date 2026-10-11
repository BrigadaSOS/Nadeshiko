import '@config/boot';
import { randomBytes } from 'crypto';
import { defaultKeyHasher } from '@better-auth/api-key';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { inferApiKeyKind } from '@app/middleware/authentication';
import { ApiKeyKind, ApiPermission, User, UserRoleType } from '@app/models';

/** Creates a SERVICE API key for machine callers. SERVICE metadata marks revisions as AGENT and bypasses user/IP
 * limits; direct insertion is required because the public better-auth endpoint cannot accept the privileged key
 * type. Usage: `npm run create:service-key -- --user <id|email> --name <name> --permissions <scopes>`. The
 * plaintext key is printed once; only its hash is stored. */

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

  // Reject unknown permissions so request-time flattening cannot silently create a key missing a scope.
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
// No existing service key receives this scope automatically: API_KEY_MASTER is
// a service key for anonymous corpus reads and must never inherit admin reads.
const PRIVILEGED_SERVICE_PERMISSIONS = new Set<ApiPermission>([ApiPermission.READ_ADMIN]);

async function resolveUser(identifier: string, permissions: ApiPermission[]): Promise<User> {
  const asId = Number(identifier);
  const user = Number.isInteger(asId)
    ? await User.findOne({ where: { id: asId } })
    : await User.findOne({ where: { email: identifier } });

  if (!user) {
    throw new Error(`No user matches '${identifier}'`);
  }

  // The key inherits this account’s identity; a shared agent key on a personal account makes edits appear under that
  // person.
  if (!user.isActive) {
    throw new Error(`User ${user.id} is inactive; an inactive owner fails auth on every request`);
  }

  // This is not a privilege boundary: API-key permissions determine authority, while the owner supplies the audit
  // identity. A mistyped `--user` makes agent edits appear under that account.
  const corpusWrites = permissions.filter((p) => CORPUS_WRITE_PERMISSIONS.has(p));
  if (corpusWrites.length > 0 && user.role !== UserRoleType.ADMIN) {
    throw new Error(
      `Refusing to attach corpus-write scope (${corpusWrites.join(', ')}) to non-admin user ` +
        `${user.id} (${user.email}, role=${user.role}).\n` +
        'The key would work, but its edits would be attributed to that account. ' +
        'Point --user at an admin, or drop the corpus-write permissions.',
    );
  }

  const privileged = permissions.filter((p) => PRIVILEGED_SERVICE_PERMISSIONS.has(p));
  if (privileged.length > 0 && user.role !== UserRoleType.ADMIN) {
    throw new Error(
      `Refusing to attach privileged service scope (${privileged.join(', ')}) to non-admin user ` +
        `${user.id} (${user.email}, role=${user.role}).`,
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

    // Print the one-time key to stdout, not logs, so callers can capture it without structured-output interleaving.
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
