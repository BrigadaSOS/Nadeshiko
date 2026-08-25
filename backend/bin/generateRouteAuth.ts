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
 *   no security                                    → throws, unless the operationId is in INTENTIONALLY_PUBLIC_OPERATIONS
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { ApiPermission } from '@app/models/ApiPermission';
import { listOperations, loadBundledSpec, type PathItem, type SecurityRequirement } from './lib/spec';
import { resolveGeneratedDir } from './lib/generatedReady';

const GENERATED_DIR = resolveGeneratedDir();
const OUTPUT_FILE = join(GENERATED_DIR, 'routeAuth.ts');

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

/**
 * Operations that are deliberately reachable with no credentials at all.
 *
 * An operation with no `security` block gets no entry in routeAuth and so no
 * auth middleware — which is correct for a genuinely public route and a silent
 * hole for every other one. The spec alone cannot tell the two apart, so the
 * default is to refuse: generation throws on any operation missing `security`
 * unless its operationId is listed here. Adding a name to this set is the one
 * place "this route is public" gets written down, and it should be argued for
 * in review like any other auth change.
 *
 *   getAnnouncement — GET /v1/admin/announcement. The site-wide banner renders
 *   for signed-out visitors too, so the read is public. The PUT that writes the
 *   announcement still carries `SessionCookie: [ADMIN]`.
 *
 *   createFeedback / getFeedbackFormToken — POST /v1/feedback and the token it
 *   requires. Feedback is open to anonymous visitors on purpose: the person most
 *   likely to hit a broken sign-up is the one who is not signed in, and a widget
 *   that first demanded an account would never hear from them. These are the
 *   only unauthenticated WRITES in the spec, so they do not lean on auth for
 *   their bot resistance — see the honeypot, the issue-time token and the
 *   per-IP limit in feedbackController. They read nothing back: the response is
 *   a fixed acknowledgement either way.
 *
 *   unsubscribeFromEmail -- POST /v1/email/unsubscribe. Read from a mail client
 *   by somebody who is not signed in, which is the entire point: an opt-out that
 *   first demanded a password is the pattern that produces spam complaints
 *   instead of unsubscribes, and `List-Unsubscribe-Post` is fired by the mailbox
 *   provider with no person present at all. Authority comes from the sealed
 *   token rather than a session -- see `@app/services/email/unsubscribe`. It
 *   reads nothing back and can only ever turn mail OFF, so the worst a forged
 *   call achieves is that we send less.
 */
export const INTENTIONALLY_PUBLIC_OPERATIONS = new Set<string>([
  'getAnnouncement',
  'createFeedback',
  'getFeedbackFormToken',
  'unsubscribeFromEmail',
  // The unsubscribe page's own pair. Same reasoning as the one-click above: the
  // reader is holding an email, not a session, and a preference screen that
  // first demanded a password is the pattern that turns an opt-out into a spam
  // complaint. Both authenticate on the sealed token instead, and both touch
  // exactly one account's email preferences and nothing else.
  'getEmailPreferencesByToken',
  'updateEmailPreferencesByToken',
]);

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

/**
 * Callers handle the empty-security case; a non-empty requirement that resolves
 * to no guard would leave the route wide open just as silently, so refuse.
 */
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

/**
 * Walks the spec's paths and derives one routeAuth entry per guarded operation.
 * Exported so the coverage test can drive it over a hand-built fragment without
 * writing anything to disk.
 */
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

// Only generate when run as a script. The coverage test imports the allowlist
// and the spec walker from this module and must not rewrite generated/ as a
// side effect of that import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generate();
}
