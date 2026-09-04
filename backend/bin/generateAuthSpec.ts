#!/usr/bin/env node
/**
 * Generates an OpenAPI description of the better-auth routes the frontend calls,
 * and merges it into a spec used ONLY by the SDK codegen.
 *
 * Why this exists
 * ---------------
 * `/v1/auth/*` is mounted by better-auth, not by our Express app, so those routes
 * have never been in the spec. The cost is paid in the frontend, where every auth
 * call hand-writes its request and response shapes and nothing checks them against
 * the server.
 *
 * Why it does NOT go in the main bundle
 * -------------------------------------
 * `docs/generated/openapi.yaml` drives more than documentation:
 *
 *   - `openapi-code-generator` builds an Express router per tag, so an `Auth` tag
 *     would generate handlers for routes better-auth already serves.
 *   - `generateRouteAuth.ts` throws for any operation with no `security` that is
 *     not explicitly allowlisted. Sign-in routes have no security by definition,
 *     so adding them would break `generate:api` outright.
 *   - `generatePublicRoutes.ts` decides which routes the Nitro proxy may inject
 *     the master API key into. That key is the admin service account. Feeding auth
 *     routes into that classifier is not a risk worth taking for typed clients.
 *
 * So the auth paths land in a separate `openapi-sdk.yaml` that only the SDK reads.
 * The main bundle, the public bundle, and every generator above are untouched.
 *
 * The public spec is unaffected either way: these are marked `x-internal: true`.
 *
 * Deliberately NOT part of `generate:api`. It builds a real better-auth instance
 * to ask it for its schema, which loads `@config/config` and so needs a valid
 * environment. The package script loads committed test defaults first and lets a
 * developer's `.env` override them, so both CI and local regeneration can build
 * the same schema without production credentials. The throw on a missing route
 * is what catches the spec drifting from what better-auth actually serves.
 */
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

/**
 * The auth routes exposed to the SDK, as better-auth names them.
 *
 * An explicit list rather than everything better-auth generates: the plugin emits
 * 41 routes and the app calls 17 of them. Each entry here becomes a generated SDK
 * method and an implied contract, so adding one should be a deliberate edit rather
 * than a side effect of upgrading a plugin.
 */
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

/** `admin/ban-user` -> `authAdminBanUser`. Stable, and unique across the set. */
/**
 * Operation ids better-auth names in a shape the SDK generator disagrees with.
 *
 * `signInWithEmailOTP` is better-auth's own id, and the two halves of the SDK
 * codegen normalize a run of capitals differently: the client factory keeps
 * `...OTP` while the function module emits `...Otp`, so the generated package
 * imports a name it does not export and the frontend fails to typecheck. Fixing
 * it at the source keeps both halves reading the same string.
 *
 * Keyed by what better-auth calls it, so an upgrade that renames the route makes
 * this entry stop applying rather than silently rename something else.
 */
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

/**
 * Prefix for better-auth's own component schemas.
 *
 * It names them `User`, `Session`, `Account`, `Verification`, `Apikey` -- generic
 * enough that our spec could grow into a collision, and ambiguous in the generated
 * SDK where `User` already means something. Prefixed on the way in, with every
 * `$ref` rewritten to match.
 */
const SCHEMA_PREFIX = 'Auth';

/**
 * Corrections to better-auth's generated schema.
 *
 * The plugin describes better-auth in general, not this deployment. It types user
 * ids as `string` because better-auth accepts `string | number`; ours are a
 * Postgres `integer` column, surfaced as `number` everywhere else in the app and
 * normalised with `Number(user.id)` in config/auth.ts.
 *
 * Left uncorrected, generated clients would force `String(user.id)` at call sites
 * and change the wire payload of admin actions from `5` to `"5"`. Describing what
 * this server actually accepts is the point of generating the spec at all.
 */
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
