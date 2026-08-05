/**
 * Asserts the two security derivations that read the same `security` block agree.
 *
 * `generateRouteAuth` decides what the API demands of a caller;
 * `generatePublicRoutes` decides where the Nitro proxy may inject the shared
 * master API key on behalf of an anonymous browser. That key belongs to the
 * admin service account, so a route in the allowlist whose middleware resolves
 * data from the *caller* would return the service account's own rows to any
 * visitor. The two now read the spec through bin/lib/spec.ts, but they still
 * apply their own rules — these tests pin the rules to each other.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildRouteAuthEntries } from '../../bin/generateRouteAuth';
import { isProxyPublic } from '../../bin/generatePublicRoutes';
import { listOperations, loadBundledSpec } from '../../bin/lib/spec';

const ALLOWLIST_FILE = resolve(import.meta.dirname, '../../../frontend/server/utils/generated/publicApiRoutes.ts');

const spec = loadBundledSpec();
const operations = listOperations(spec);
const routeAuthEntries = buildRouteAuthEntries(spec.paths);

const middlewareByRoute = new Map(routeAuthEntries.map((entry) => [`${entry.method} ${entry.path}`, entry]));

/** Operations the proxy rule says may be called with the injected master key. */
const proxyPublicOperations = operations.filter((op) => isProxyPublic(op.security));

function describeOperation(op: (typeof operations)[number]): string {
  return `${op.method.toUpperCase()} ${op.path} (${op.operationId ?? 'unknown'})`;
}

describe('proxy allowlist agrees with route auth', () => {
  it('allowlists at least one route', () => {
    // Guards every assertion below from passing vacuously if the rule ever
    // starts rejecting everything.
    expect(proxyPublicOperations.length).toBeGreaterThan(0);
  });

  it('every allowlisted route is one the API accepts an API key for', () => {
    const offenders = proxyPublicOperations
      .filter((op) => {
        const entry = middlewareByRoute.get(`${op.method} ${op.expressPath}`);
        return !entry?.middleware.includes('enforceApiKeyScope');
      })
      .map(describeOperation);

    expect(offenders).toEqual([]);
  });

  it('no allowlisted route requires a session the proxy cannot supply', () => {
    // The proxy injects a bare API key and no cookie. A route whose middleware
    // demands a session would either reject the call or — worse, if the key
    // satisfies it — answer as the service account.
    const offenders = proxyPublicOperations
      .filter((op) => {
        const middleware = middlewareByRoute.get(`${op.method} ${op.expressPath}`)?.middleware ?? '';
        return middleware.includes('requireSession') || middleware.includes('enforceSessionAdmin');
      })
      .map(describeOperation);

    expect(offenders).toEqual([]);
  });

  it('every allowlisted route is scoped to reading the shared corpus', () => {
    const offenders = proxyPublicOperations
      .filter((op) => {
        const scopes = (op.security ?? []).flatMap((requirement) => requirement.ApiKey ?? []);
        return scopes.length === 0 || scopes.some((scope) => scope !== 'READ_MEDIA');
      })
      .map(describeOperation);

    expect(offenders).toEqual([]);
  });

  it('never allowlists a route that declares no security at all', () => {
    const offenders = operations
      .filter((op) => !op.security || op.security.length === 0)
      .filter((op) => isProxyPublic(op.security))
      .map(describeOperation);

    expect(offenders).toEqual([]);
  });

  it('the committed allowlist matches what the rule derives from the spec', () => {
    const committed = [...readFileSync(ALLOWLIST_FILE, 'utf8').matchAll(/\{ method: '(\w+)', path: '([^']+)' \}/g)]
      .map((match) => `${match[1]} ${match[2]}`)
      .sort();

    const derived = proxyPublicOperations.map((op) => `${op.method.toUpperCase()} ${op.path}`).sort();

    expect(committed).toEqual(derived);
  });
});
