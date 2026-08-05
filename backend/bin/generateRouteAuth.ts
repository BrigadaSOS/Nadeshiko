/**
 * Generates route auth middleware from OpenAPI security definitions.
 *
 * Reads the bundled openapi.yaml and emits generated/routeAuth.ts which maps
 * each route (method + path) to the appropriate auth middleware based on
 * the security field in the spec.
 *
 * Derivation rules:
 *   [{SessionCookie: []}]                          → requireSession()
 *   [{SessionCookie: [ADMIN]}]                     → requireSession(enforceAdminAccess)
 *   [{ApiKey: [P]}, {SessionCookie: []}]           → requireAuth(enforceApiKeyScope(ApiPermission.P))
 *   [{ApiKey: [P]}, {SessionCookie: [ADMIN]}]      → requireAuth(enforceSessionAdmin, enforceApiKeyScope(ApiPermission.P))
 *   [{ApiKey: [P]}]                                → requireAuth(enforceApiKeyScope(ApiPermission.P))
 *   [{ApiKey: [W]}] where W is a corpus write      → requireAuth(enforceSessionAdmin, enforceApiKeyScope(ApiPermission.W))
 *   no security                                    → (skipped, handled manually)
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { parse } from 'yaml';
import { ApiPermission } from '@app/models/ApiPermission';

const GENERATED_DIR = resolve(import.meta.dir, '../generated');
const BUNDLED_SPEC = resolve(import.meta.dir, '../docs/generated/openapi.yaml');
const OUTPUT_FILE = join(GENERATED_DIR, 'routeAuth.ts');

interface SecurityRequirement {
  [scheme: string]: string[];
}

interface Operation {
  operationId?: string;
  security?: SecurityRequirement[];
}

interface PathItem {
  get?: Operation;
  post?: Operation;
  patch?: Operation;
  put?: Operation;
  delete?: Operation;
}

/**
 * Permissions that mutate the shared media corpus rather than data the caller
 * owns. The spec marks these routes ApiKey-only, but browser traffic still
 * reaches them through the frontend proxy carrying only a session cookie, and
 * `enforceApiKeyScope` waves sessions straight through. Without an explicit
 * admin check any signed-in user could create, edit or delete corpus entries.
 *
 * Owner-scoped permissions (profile, activity, collections) stay out of this
 * set: those routes are legitimately session-driven from the web app and the
 * controllers already enforce per-user ownership.
 */
const CORPUS_WRITE_PERMISSIONS = new Set<string>([
  ApiPermission.ADD_MEDIA,
  ApiPermission.UPDATE_MEDIA,
  ApiPermission.REMOVE_MEDIA,
]);

function openApiPathToExpress(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}

/**
 * A scheme key present with no scope list means the bundled spec is malformed.
 * Deriving middleware from it would silently emit a weaker guard than the route
 * is meant to have, so refuse to generate instead.
 */
function requireScopes(requirement: SecurityRequirement, scheme: string): string[] {
  const scopes = requirement[scheme];
  if (!scopes) {
    throw new Error(`Malformed spec: security scheme "${scheme}" has no scope list`);
  }
  return scopes;
}

function requireApiKeyPermission(requirement: SecurityRequirement): string {
  const permission = requireScopes(requirement, 'ApiKey')[0];
  if (!permission) {
    throw new Error('Malformed spec: ApiKey security requirement has no permission scope');
  }
  return permission;
}

function deriveMiddleware(security: SecurityRequirement[]): string | null {
  if (security.length === 0) return null;

  const apiKeyReq = security.find((s) => 'ApiKey' in s);
  const sessionReq = security.find((s) => 'SessionCookie' in s);

  if (sessionReq && !apiKeyReq) {
    const roles = requireScopes(sessionReq, 'SessionCookie');
    if (roles.includes('ADMIN')) {
      return 'requireSession(enforceAdminAccess)';
    }
    return 'requireSession()';
  }

  if (apiKeyReq && sessionReq) {
    const permission = requireApiKeyPermission(apiKeyReq);
    const roles = requireScopes(sessionReq, 'SessionCookie');

    if (roles.includes('ADMIN')) {
      return `requireAuth(enforceSessionAdmin, enforceApiKeyScope(ApiPermission.${permission}))`;
    }
    return `requireAuth(enforceApiKeyScope(ApiPermission.${permission}))`;
  }

  if (apiKeyReq && !sessionReq) {
    const permission = requireApiKeyPermission(apiKeyReq);

    if (CORPUS_WRITE_PERMISSIONS.has(permission)) {
      return `requireAuth(enforceSessionAdmin, enforceApiKeyScope(ApiPermission.${permission}))`;
    }

    return `requireAuth(enforceApiKeyScope(ApiPermission.${permission}))`;
  }

  return null;
}

interface RouteEntry {
  method: string;
  path: string;
  operationId: string;
  middleware: string;
}

function generate(): void {
  const spec = parse(readFileSync(BUNDLED_SPEC, 'utf8'));
  const paths: Record<string, PathItem> = spec.paths;
  const entries: RouteEntry[] = [];
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;

  for (const [openApiPath, pathItem] of Object.entries(paths)) {
    const expressPath = openApiPathToExpress(openApiPath);

    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;

      const security = operation.security;
      if (!security || security.length === 0) continue;

      const middleware = deriveMiddleware(security);
      if (!middleware) continue;

      entries.push({
        method,
        path: expressPath,
        operationId: operation.operationId ?? 'unknown',
        middleware,
      });
    }
  }

  const usesApiPermission = entries.some((e) => e.middleware.includes('ApiPermission'));
  const usesEnforceSessionAdmin = entries.some((e) => e.middleware.includes('enforceSessionAdmin'));
  const usesEnforceAdminAccess = entries.some((e) => e.middleware.includes('enforceAdminAccess'));
  const usesEnforceApiKeyScope = entries.some((e) => e.middleware.includes('enforceApiKeyScope'));
  const usesRequireAuth = entries.some((e) => e.middleware.includes('requireAuth'));
  const usesRequireSession = entries.some((e) => e.middleware.includes('requireSession'));

  const imports: string[] = [];
  if (usesApiPermission) imports.push('ApiPermission');
  if (usesEnforceAdminAccess) imports.push('enforceAdminAccess');
  if (usesEnforceSessionAdmin) imports.push('enforceSessionAdmin');
  if (usesEnforceApiKeyScope) imports.push('enforceApiKeyScope');
  if (usesRequireAuth) imports.push('requireAuth');
  if (usesRequireSession) imports.push('requireSession');

  const lines: string[] = [
    '/** AUTOGENERATED from OpenAPI security definitions — DO NOT EDIT **/',
    '',
    `import type { RequestHandler } from 'express';`,
    `import { ${imports.join(', ')} } from '@app/middleware/routePolicies';`,
    '',
    'export interface RouteAuth {',
    '  method: string;',
    '  path: string;',
    '  middleware: RequestHandler;',
    '}',
    '',
    'export const routeAuth: RouteAuth[] = [',
  ];

  for (const entry of entries) {
    lines.push(`  { method: '${entry.method}', path: '${entry.path}', middleware: ${entry.middleware} },`);
  }

  lines.push('];');
  lines.push('');

  writeFileSync(OUTPUT_FILE, lines.join('\n'));
  console.log(`Generated ${OUTPUT_FILE} with ${entries.length} route auth entries.`);
}

generate();
