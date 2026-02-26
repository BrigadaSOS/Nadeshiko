import '@config/boot';
import { Client } from 'pg';
import { getAdminPostgresConfig, getAppPostgresConfig } from '@config/postgresConfig';
import { logger } from '@config/log';
import { ensureDestructiveAllowed } from './destructiveGuard';

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

interface AdminConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface BootstrapPostgresOptions {
  recreateRoleAndDatabase?: boolean;
}

async function dropRoleAndDatabase(
  adminClient: Client,
  adminConfig: AdminConnectionConfig,
  appUser: string,
  appDatabase: string,
  adminUser: string,
): Promise<void> {
  const quotedUser = quoteIdentifier(appUser);
  const quotedDatabase = quoteIdentifier(appDatabase);
  const quotedAdminUser = quoteIdentifier(adminUser);

  const roleExists = await adminClient.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);

  if (roleExists.rowCount !== 0) {
    // REASSIGN/DROP OWNED BY only affects the current database.
    // The role may own objects in multiple databases (e.g. app DB + test DB),
    // so we must connect to each one and revoke there.
    const allDatabases = await adminClient.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datistemplate = false',
    );

    for (const { datname } of allDatabases.rows) {
      const dbClient = new Client({ ...adminConfig, database: datname });
      await dbClient.connect();
      try {
        logger.info(`Revoking objects owned by '${appUser}' in '${datname}'`);
        await dbClient.query(`REASSIGN OWNED BY ${quotedUser} TO ${quotedAdminUser}`);
        await dbClient.query(`DROP OWNED BY ${quotedUser}`);
      } finally {
        await dbClient.end();
      }
    }
  }

  const databaseExists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [appDatabase]);
  if (databaseExists.rowCount !== 0) {
    logger.info(`Dropping PostgreSQL database '${appDatabase}'`);
    await adminClient.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `,
      [appDatabase],
    );
    await adminClient.query(`DROP DATABASE ${quotedDatabase}`);
  }

  if (roleExists.rowCount !== 0) {
    logger.info(`Dropping PostgreSQL role '${appUser}'`);
    await adminClient.query(`DROP ROLE ${quotedUser}`);
  }
}

async function ensureRoleAndDatabase(
  adminClient: Client,
  appUser: string,
  appPassword: string,
  appDatabase: string,
): Promise<void> {
  const quotedUser = quoteIdentifier(appUser);
  const quotedDatabase = quoteIdentifier(appDatabase);

  const roleExists = await adminClient.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);

  if (roleExists.rowCount === 0) {
    await adminClient.query(
      `CREATE ROLE ${quotedUser} LOGIN PASSWORD ${quoteLiteral(appPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT`,
    );
    logger.info(`Created PostgreSQL role '${appUser}'`);
  } else {
    await adminClient.query(
      `ALTER ROLE ${quotedUser} LOGIN PASSWORD ${quoteLiteral(appPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT`,
    );
    logger.info(`Updated PostgreSQL role '${appUser}'`);
  }

  const databaseExists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [appDatabase]);

  if (databaseExists.rowCount === 0) {
    await adminClient.query(`CREATE DATABASE ${quotedDatabase} OWNER ${quotedUser}`);
    logger.info(`Created PostgreSQL database '${appDatabase}'`);
  } else {
    await adminClient.query(`ALTER DATABASE ${quotedDatabase} OWNER TO ${quotedUser}`);
    logger.info(`Database '${appDatabase}' already exists; owner confirmed`);
  }

  await adminClient.query(`REVOKE ALL ON DATABASE ${quotedDatabase} FROM PUBLIC`);
  await adminClient.query(`GRANT CONNECT, TEMP ON DATABASE ${quotedDatabase} TO ${quotedUser}`);
}

async function ensureSchemaAccess(adminConfig: Client, appUser: string): Promise<void> {
  const quotedUser = quoteIdentifier(appUser);

  await adminConfig.query('BEGIN');
  try {
    await adminConfig.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await adminConfig.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quotedUser}`);
    await adminConfig.query(`ALTER SCHEMA public OWNER TO ${quotedUser}`);
    await adminConfig.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${quotedUser}`);
    await adminConfig.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${quotedUser}`);
    await adminConfig.query(`GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO ${quotedUser}`);

    // Transfer ownership of all functions in public schema so the app user can drop them.
    const publicFunctions = await adminConfig.query<{ oid: string; signature: string }>(`
      SELECT p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = $1)
    `, [appUser]);
    for (const fn of publicFunctions.rows) {
      await adminConfig.query(`ALTER FUNCTION public.${fn.signature} OWNER TO ${quotedUser}`);
    }

    // pg-boss keeps its tables/functions in this schema.
    // Ensure the app role can read/write/create there even if schema was created by another role.
    await adminConfig.query(`CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${quotedUser}`);
    await adminConfig.query('REVOKE ALL ON SCHEMA pgboss FROM PUBLIC');
    await adminConfig.query(`GRANT USAGE, CREATE ON SCHEMA pgboss TO ${quotedUser}`);
    await adminConfig.query(`ALTER SCHEMA pgboss OWNER TO ${quotedUser}`);
    await adminConfig.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA pgboss TO ${quotedUser}`);
    await adminConfig.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pgboss TO ${quotedUser}`);
    await adminConfig.query(`GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA pgboss TO ${quotedUser}`);
    await adminConfig.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedUser} IN SCHEMA pgboss GRANT ALL PRIVILEGES ON TABLES TO ${quotedUser}`,
    );
    await adminConfig.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedUser} IN SCHEMA pgboss GRANT ALL PRIVILEGES ON SEQUENCES TO ${quotedUser}`,
    );
    await adminConfig.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedUser} IN SCHEMA pgboss GRANT ALL PRIVILEGES ON ROUTINES TO ${quotedUser}`,
    );
    await adminConfig.query('COMMIT');
  } catch (error) {
    await adminConfig.query('ROLLBACK');
    throw error;
  }
}

export async function bootstrapPostgres(): Promise<void> {
  await bootstrapPostgresWithOptions();
}

export async function bootstrapPostgresWithOptions(options: BootstrapPostgresOptions = {}): Promise<void> {
  const { recreateRoleAndDatabase = false } = options;
  const appPostgres = getAppPostgresConfig();
  const adminPostgres = getAdminPostgresConfig();

  const appUser = requireEnv('POSTGRES_USER', appPostgres.user);
  const appPassword = requireEnv('POSTGRES_PASSWORD', appPostgres.password);
  const appDatabase = requireEnv('POSTGRES_DB', appPostgres.database);

  const adminHost = requireEnv('POSTGRES_ADMIN_HOST or POSTGRES_HOST', adminPostgres.host);
  const adminUser = requireEnv('POSTGRES_ADMIN_USER or POSTGRES_USER', adminPostgres.user);
  const adminPassword = requireEnv('POSTGRES_ADMIN_PASSWORD or POSTGRES_PASSWORD', adminPostgres.password);

  logger.info(
    `Bootstrapping PostgreSQL role '${appUser}' and database '${appDatabase}'${recreateRoleAndDatabase ? ' (destructive recreate)' : ''}`,
  );

  const adminConnectionConfig: AdminConnectionConfig = {
    host: adminHost,
    port: adminPostgres.port,
    user: adminUser,
    password: adminPassword,
    database: adminPostgres.database,
  };

  const adminClient = new Client(adminConnectionConfig);

  await adminClient.connect();
  try {
    if (recreateRoleAndDatabase) {
      await dropRoleAndDatabase(adminClient, adminConnectionConfig, appUser, appDatabase, adminUser);
    }
    await ensureRoleAndDatabase(adminClient, appUser, appPassword, appDatabase);
  } finally {
    await adminClient.end();
  }

  const schemaClient = new Client({
    host: adminHost,
    port: adminPostgres.port,
    user: adminUser,
    password: adminPassword,
    database: appDatabase,
  });

  await schemaClient.connect();
  try {
    await ensureSchemaAccess(schemaClient, appUser);
  } finally {
    await schemaClient.end();
  }

  logger.info(`PostgreSQL bootstrap complete for '${appUser}' on database '${appDatabase}'`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const recreateRoleAndDatabase = args.includes('--recreate-role-and-db');
  if (recreateRoleAndDatabase) {
    ensureDestructiveAllowed('db:bootstrap --recreate-role-and-db', args);
  }

  bootstrapPostgresWithOptions({ recreateRoleAndDatabase }).catch((error) => {
    logger.error(error, 'PostgreSQL bootstrap failed');
    process.exit(1);
  });
}
