import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { routeAuth } from 'generated/routeAuth';
import { INTENTIONALLY_PUBLIC_OPERATIONS, buildRouteAuthEntries } from '../../bin/generateRouteAuth';

const BUNDLED_SPEC = resolve(import.meta.dirname, '../../docs/generated/openapi.yaml');

interface SecurityRequirement {
  [scheme: string]: string[];
}

interface Operation {
  operationId?: string;
  security?: SecurityRequirement[];
}

interface PathItem {
  [method: string]: Operation;
}

const HTTP_METHODS = new Set(['get', 'post', 'patch', 'put', 'delete']);

function loadSpec() {
  return parse(readFileSync(BUNDLED_SPEC, 'utf8')) as { paths: Record<string, PathItem> };
}

function openApiPathToExpress(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}

describe('OpenAPI security definitions', () => {
  const spec = loadSpec();
  const allOperations: { path: string; method: string; operationId: string; security: SecurityRequirement[] }[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;

      allOperations.push({
        path,
        method,
        operationId: operation.operationId ?? 'unknown',
        security: operation.security ?? [],
      });
    }
  }

  const publicOperations = allOperations.filter((op) => op.security.length === 0);
  // Every test below asserts the shape of a security requirement, so they run
  // over the guarded operations only. Which operations are allowed to have no
  // requirement at all is the separate invariant asserted immediately below.
  const guardedOperations = allOperations.filter((op) => op.security.length > 0);

  it('every operation without a security block is a declared public route', () => {
    const undeclared = publicOperations
      .filter((op) => !INTENTIONALLY_PUBLIC_OPERATIONS.has(op.operationId))
      .map((op) => `${op.method.toUpperCase()} ${op.path} (${op.operationId})`);

    expect(undeclared).toEqual([]);
  });

  it('every declared public operation is still a public operation in the spec', () => {
    const publicIds = new Set(publicOperations.map((op) => op.operationId));
    const stale = [...INTENTIONALLY_PUBLIC_OPERATIONS].filter((operationId) => !publicIds.has(operationId));

    expect(stale).toEqual([]);
  });

  it('only uses known security schemes', () => {
    const knownSchemes = new Set(['ApiKey', 'SessionCookie']);

    for (const op of guardedOperations) {
      for (const req of op.security) {
        for (const scheme of Object.keys(req)) {
          expect(knownSchemes.has(scheme)).toBe(true);
        }
      }
    }
  });

  it('only uses known ApiKey permissions', () => {
    const knownPermissions = new Set([
      'READ_MEDIA',
      'ADD_MEDIA',
      'UPDATE_MEDIA',
      'REMOVE_MEDIA',
      'READ_PROFILE',
      'WRITE_PROFILE',
      'READ_ACTIVITY',
      'READ_COLLECTIONS',
      'CREATE_COLLECTIONS',
      'UPDATE_COLLECTIONS',
      'DELETE_COLLECTIONS',
    ]);

    for (const op of guardedOperations) {
      for (const req of op.security) {
        if (req.ApiKey) {
          for (const perm of req.ApiKey) {
            expect(knownPermissions.has(perm)).toBe(true);
          }
        }
      }
    }
  });

  it('only uses known SessionCookie roles', () => {
    const knownRoles = new Set(['ADMIN']);

    for (const op of guardedOperations) {
      for (const req of op.security) {
        if (req.SessionCookie) {
          for (const role of req.SessionCookie) {
            expect(knownRoles.has(role)).toBe(true);
          }
        }
      }
    }
  });

  it('all admin routes require ADMIN session', () => {
    const adminOps = guardedOperations.filter((op) => op.path.startsWith('/v1/admin/'));
    expect(adminOps.length).toBeGreaterThan(0);

    for (const op of adminOps) {
      const sessionReq = op.security.find((s) => 'SessionCookie' in s);
      expect(sessionReq).toBeDefined();
      expect(sessionReq?.SessionCookie).toContain('ADMIN');
    }
  });

  it('all user routes require exactly one security scheme', () => {
    const userOps = guardedOperations.filter((op) => op.path.startsWith('/v1/user/'));
    expect(userOps.length).toBeGreaterThan(0);

    for (const op of userOps) {
      expect(op.security).toHaveLength(1);
    }
  });

  it('all collection routes require exactly one security scheme', () => {
    const collectionOps = guardedOperations.filter((op) => op.path.startsWith('/v1/collections'));
    expect(collectionOps.length).toBeGreaterThan(0);

    for (const op of collectionOps) {
      expect(op.security).toHaveLength(1);
    }
  });

  it('all search routes require ApiKey READ_MEDIA', () => {
    const searchOps = guardedOperations.filter((op) => op.path.startsWith('/v1/search'));
    expect(searchOps.length).toBeGreaterThan(0);

    for (const op of searchOps) {
      expect(op.security).toHaveLength(1);
      const apiKeyReq = op.security.find((s) => 'ApiKey' in s);
      expect(apiKeyReq?.ApiKey).toEqual(['READ_MEDIA']);
    }
  });
});

describe('generated routeAuth coverage', () => {
  const spec = loadSpec();
  const routeAuthKeys = new Set(routeAuth.map((r) => `${r.method} ${r.path}`));

  it('has an entry for every spec operation with security', () => {
    const missing: string[] = [];

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) continue;
        if (!operation.security || operation.security.length === 0) continue;

        const expressPath = openApiPathToExpress(path);
        const key = `${method} ${expressPath}`;
        if (!routeAuthKeys.has(key)) {
          missing.push(`${method.toUpperCase()} ${path} (${operation.operationId})`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('has no extra entries beyond the spec', () => {
    const specKeys = new Set<string>();

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) continue;
        if (!operation.security || operation.security.length === 0) continue;

        const expressPath = openApiPathToExpress(path);
        specKeys.add(`${method} ${expressPath}`);
      }
    }

    const extra = routeAuth.map((r) => `${r.method} ${r.path}`).filter((key) => !specKeys.has(key));

    expect(extra).toEqual([]);
  });

  it('leaves declared public operations unguarded', () => {
    const publicKeys: string[] = [];

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method)) continue;
        if (!INTENTIONALLY_PUBLIC_OPERATIONS.has(operation.operationId ?? '')) continue;

        publicKeys.push(`${method} ${openApiPathToExpress(path)}`);
      }
    }

    expect(publicKeys).toContain('get /v1/admin/announcement');
    expect(publicKeys.filter((key) => routeAuthKeys.has(key))).toEqual([]);
  });
});

describe('routeAuth generation', () => {
  it('refuses to generate an operation that declares no security', () => {
    expect(() => buildRouteAuthEntries({ '/v1/widgets': { get: { operationId: 'listWidgets' } } })).toThrow(
      /Missing security block: GET \/v1\/widgets \("listWidgets"\)/,
    );
  });

  it('refuses to generate an operation with no operationId to allowlist', () => {
    expect(() => buildRouteAuthEntries({ '/v1/widgets': { get: {} } })).toThrow(/Missing security block/);
  });

  it('emits no entry for a declared public operation', () => {
    const entries = buildRouteAuthEntries({ '/v1/admin/announcement': { get: { operationId: 'getAnnouncement' } } });

    expect(entries).toEqual([]);
  });

  it('still derives middleware for a guarded operation', () => {
    const entries = buildRouteAuthEntries({
      '/v1/widgets/{widgetId}': { get: { operationId: 'getWidget', security: [{ SessionCookie: ['ADMIN'] }] } },
    });

    expect(entries).toEqual([
      {
        method: 'get',
        path: '/v1/widgets/:widgetId',
        operationId: 'getWidget',
        middleware: 'requireSession(enforceAdminAccess)',
      },
    ]);
  });

  it('refuses a security requirement that names no known scheme', () => {
    expect(() =>
      buildRouteAuthEntries({ '/v1/widgets': { get: { operationId: 'listWidgets', security: [{ Mystery: [] }] } } }),
    ).toThrow(/names neither ApiKey nor SessionCookie/);
  });
});
