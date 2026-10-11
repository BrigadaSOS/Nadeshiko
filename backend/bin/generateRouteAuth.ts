/** Generates route middleware from OpenAPI security, preserving the documented SessionCookie/ApiKey combinations and
 * failing on unlisted unauthenticated operations. */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { ApiPermission } from '@app/models/ApiPermission';
import { listOperations, loadBundledSpec, type PathItem, type SecurityRequirement } from './lib/spec';
import { resolveGeneratedDir } from './lib/generatedReady';

const GENERATED_DIR = resolveGeneratedDir();
const OUTPUT_FILE = join(GENERATED_DIR, 'routeAuth.ts');

/** Corpus-write permissions require an admin session in addition to the API-key scope: browser proxy traffic carries
 * only a session, and scope checking alone would let any signed-in user mutate shared media. */
const CORPUS_WRITE_PERMISSIONS = new Set<string>([
  ApiPermission.ADD_MEDIA,
  ApiPermission.UPDATE_MEDIA,
  ApiPermission.REMOVE_MEDIA,
]);

/** Explicit unauthenticated allowlist. Missing `security` otherwise fails generation; entries must justify why the
 * route is public, including feedback/unsubscribe token protections and their no-read/fixed-response contracts. */
export const INTENTIONALLY_PUBLIC_OPERATIONS = new Set<string>([
  'getAnnouncement',
  'createFeedback',
  'getFeedbackFormToken',
  'unsubscribeFromEmail',
  // The unsubscribe page accepts only its sealed token, not a session; both routes touch exactly one account’s email
  // preferences.
  'getEmailPreferencesByToken',
  'updateEmailPreferencesByToken',
  // The roadmap is the public promise this feature exists to make: proposals
  // and requester identities are filtered out by its controller.
  'listRoadmap',
]);

/** A security scheme without scopes is malformed; refusing generation prevents a weaker guard from being emitted
 * silently. */
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

/** A nonempty security requirement that yields no guard would open the route; fail generation. */
function deriveMiddleware(security: SecurityRequirement[], operationId: string): string {
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

  throw new Error(
    `Malformed spec: security requirement for "${operationId}" names neither ApiKey nor SessionCookie, ` +
      'so no auth middleware can be derived for it.',
  );
}

interface RouteEntry {
  method: string;
  path: string;
  operationId: string;
  middleware: string;
}

/** Walks guarded operations without writing, so coverage tests can exercise route derivation on an in-memory spec. */
export function buildRouteAuthEntries(paths: Record<string, PathItem>): RouteEntry[] {
  const entries: RouteEntry[] = [];

  for (const op of listOperations({ paths })) {
    const operationId = op.operationId ?? 'unknown';
    const security = op.security;

    if (!security || security.length === 0) {
      if (INTENTIONALLY_PUBLIC_OPERATIONS.has(operationId)) continue;

      throw new Error(
        `Missing security block: ${op.method.toUpperCase()} ${op.path} ("${operationId}") would ship as a ` +
          'fully public route. Give it a `security:` block, or — if it is meant to be public — add its ' +
          'operationId to INTENTIONALLY_PUBLIC_OPERATIONS in bin/generateRouteAuth.ts.',
      );
    }

    entries.push({
      method: op.method,
      path: op.expressPath,
      operationId,
      middleware: deriveMiddleware(security, operationId),
    });
  }

  return entries;
}

function generate(): void {
  const spec = loadBundledSpec();
  const entries = buildRouteAuthEntries(spec.paths);

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

// Generate only as a script; importing the allowlist/walker must not rewrite generated output.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generate();
}
