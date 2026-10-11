#!/usr/bin/env node
/** Generates better-auth routes into the SDK-only OpenAPI bundle. Keep them out of the main bundle: Express/router,
 * auth-allowlist, and proxy-key generators would treat these routes as application routes. This command builds a
 * real auth instance, so committed test defaults must load before environment overrides. */
import { writeFileSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { betterAuth } from 'better-auth';
import { openAPI } from 'better-auth/plugins';
import { parse, stringify } from 'yaml';
import { buildAuthOptions } from '@config/auth';

const DOCS_GENERATED = resolve(import.meta.dirname, '../docs/generated');
const MAIN_BUNDLE = join(DOCS_GENERATED, 'openapi.yaml');
const SDK_BUNDLE = join(DOCS_GENERATED, 'openapi-sdk.yaml');

/** Where better-auth is mounted (see config/routes.ts). */
const AUTH_BASE_PATH = '/v1/auth';

/** Explicit SDK route list: each entry becomes a generated method and contract, rather than changing implicitly when
 * the auth plugin emits new routes. */
const EXPOSED_ROUTES = [
  '/get-session',
  '/sign-out',
  '/sign-in/social',
  '/sign-in/magic-link',
  '/sign-in/email-otp',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/delete-user',
  '/change-email',
  '/api-key/create',
  '/api-key/list',
  '/api-key/update',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/impersonate-user',
  '/admin/stop-impersonating',
] as const;

type Operation = Record<string, unknown> & {
  operationId?: string;
  tags?: string[];
  responses?: Record<string, unknown>;
};
type PathItem = Record<string, Operation>;

/** Normalize better-auth operation IDs only where the SDK generator disagrees; key the mapping by the source ID so
 * renamed routes stop applying. */
const OPERATION_ID_OVERRIDES: Record<string, string> = {
  signInWithEmailOTP: 'signInWithEmailOtp',
};

function deriveOperationId(path: string): string {
  const words = path
    .split('/')
    .filter(Boolean)
    .flatMap((segment) => segment.replace(/[{}]/g, '').split('-'))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  return `auth${words.join('')}`;
}

/** Prefix better-auth component schemas and rewrite their `$ref`s to avoid collisions with this spec’s generic
 * generated types. */
const SCHEMA_PREFIX = 'Auth';

/** Correct generated schemas to this server’s wire types: user IDs are Postgres integers here, not the plugin’s
 * general `string | number`, so clients emit numeric IDs. */
const SCHEMA_CORRECTIONS: { path: string; property: string; schema: Record<string, unknown> }[] = [
  { path: '/admin/ban-user', property: 'userId', schema: { type: 'integer' } },
  { path: '/admin/unban-user', property: 'userId', schema: { type: 'integer' } },
  { path: '/admin/impersonate-user', property: 'userId', schema: { type: 'integer' } },
];

/** Applies the corrections above to one path item, in place. */
function applyCorrections(route: string, item: PathItem): void {
  for (const correction of SCHEMA_CORRECTIONS.filter((c) => c.path === route)) {
    let applied = false;

    for (const operation of Object.values(item)) {
      const body = operation.requestBody as
        | { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> }
        | undefined;
      const properties = body?.content?.['application/json']?.schema?.properties;

      if (properties && correction.property in properties) {
        properties[correction.property] = correction.schema;
        applied = true;
      }
    }

    if (!applied) {
      throw new Error(
        `Correction for ${route}.${correction.property} matched nothing. better-auth changed its schema; ` +
          're-check whether the correction is still needed in bin/generateAuthSpec.ts.',
      );
    }
  }
}

/** Rewrites `#/components/schemas/X` to `#/components/schemas/AuthX`, anywhere in the tree. */
function namespaceRefs<T>(node: T): T {
  if (Array.isArray(node)) return node.map(namespaceRefs) as T;
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      out[key] = value.replace(/^#\/components\/schemas\/(.+)$/, `#/components/schemas/${SCHEMA_PREFIX}$1`);
    } else {
      out[key] = namespaceRefs(value);
    }
  }
  return out as T;
}

async function generateAuthSpec(): Promise<{ paths: Record<string, PathItem>; schemas: Record<string, unknown> }> {
  const base = buildAuthOptions();
  const instance = betterAuth({
    ...base,
    // No Scalar UI: the default mounts one at `${basePath}/reference`, which the
    // Nitro proxy would happily serve to anyone.
    plugins: [...(base.plugins ?? []), openAPI({ disableDefaultReference: true })],
  });

  const schema = await (
    instance.api as unknown as {
      generateOpenAPISchema: () => Promise<{
        paths: Record<string, PathItem>;
        components?: { schemas?: Record<string, unknown> };
      }>;
    }
  ).generateOpenAPISchema();

  const out: Record<string, PathItem> = {};
  const missing: string[] = [];

  for (const route of EXPOSED_ROUTES) {
    const item = schema.paths[route];
    if (!item) {
      missing.push(route);
      continue;
    }

    // Corrected before namespacing, so corrections match better-auth's own names.
    const corrected: PathItem = structuredClone(item);
    applyCorrections(route, corrected);

    const prefixed: PathItem = {};
    for (const [method, operation] of Object.entries(corrected)) {
      const op: Operation = { ...operation };

      // Tagged `Auth` (declared x-internal in the SDK spec) rather than better-auth's
      // own grouping, which uses "Default" for core routes.
      op.tags = ['Auth'];
      op['x-internal'] = true;
      op.operationId ||= deriveOperationId(route);
      op.operationId = OPERATION_ID_OVERRIDES[op.operationId] ?? op.operationId;

      const hasSuccess = Object.keys(op.responses ?? {}).some((code) => code.startsWith('2'));
      if (!hasSuccess) {
        // The generator would otherwise emit a method with no success type.
        op.responses = { ...(op.responses ?? {}), '200': { description: 'OK' } };
      }

      prefixed[method] = namespaceRefs(op);
    }

    out[`${AUTH_BASE_PATH}${route}`] = prefixed;
  }

  if (missing.length > 0) {
    throw new Error(
      `better-auth no longer generates: ${missing.join(', ')}. ` +
        'A plugin was removed or renamed a route; update EXPOSED_ROUTES in this file.',
    );
  }

  const schemas: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(schema.components?.schemas ?? {})) {
    schemas[`${SCHEMA_PREFIX}${name}`] = namespaceRefs(definition);
  }

  return { paths: out, schemas };
}

async function main(): Promise<void> {
  const mainSpec = parse(readFileSync(MAIN_BUNDLE, 'utf8')) as {
    paths: Record<string, unknown>;
    components?: { schemas?: Record<string, unknown> } & Record<string, unknown>;
    tags?: { name: string; description?: string; 'x-internal'?: boolean }[];
  };

  const { paths: authPaths, schemas: authSchemas } = await generateAuthSpec();

  const pathCollisions = Object.keys(authPaths).filter((p) => p in mainSpec.paths);
  if (pathCollisions.length > 0) {
    throw new Error(`auth paths collide with real spec paths: ${pathCollisions.join(', ')}`);
  }

  const existingSchemas = mainSpec.components?.schemas ?? {};
  const schemaCollisions = Object.keys(authSchemas).filter((name) => name in existingSchemas);
  if (schemaCollisions.length > 0) {
    throw new Error(`auth schemas collide with real spec schemas: ${schemaCollisions.join(', ')}`);
  }

  mainSpec.paths = { ...mainSpec.paths, ...authPaths };
  mainSpec.components = { ...mainSpec.components, schemas: { ...existingSchemas, ...authSchemas } };
  mainSpec.tags = [
    ...(mainSpec.tags ?? []),
    {
      name: 'Auth',
      'x-internal': true,
      description:
        'Session and credential endpoints served by better-auth. Present so first-party clients get generated types; never part of the public API.',
    },
  ];

  writeFileSync(SDK_BUNDLE, stringify(mainSpec), 'utf8');
  console.log(
    `Wrote ${SDK_BUNDLE}: ${Object.keys(authPaths).length} auth paths and ${Object.keys(authSchemas).length} schemas ` +
      `merged into ${Object.keys(mainSpec.paths).length} paths total.`,
  );
}

await main();
