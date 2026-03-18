import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { routeAuth } from 'generated/routeAuth';

const BUNDLED_SPEC = resolve(import.meta.dir, '../../docs/generated/openapi.yaml');

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

const SKIPPED_OPERATIONS = new Set(['impersonateAdminUser', 'clearAdminImpersonation', 'getAnnouncement']);
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
      if (SKIPPED_OPERATIONS.has(operation.operationId ?? '')) continue;

      allOperations.push({
        path,
        method,
        operationId: operation.operationId ?? 'unknown',
        security: operation.security ?? [],
      });
    }
  }

  it('every operation has a security definition', () => {
    const missing = allOperations.filter((op) => op.security.length === 0);
    expect(missing.map((op) => `${op.method.toUpperCase()} ${op.path} (${op.operationId})`)).toEqual([]);
  });

  it('only uses known security schemes', () => {
    const knownSchemes = new Set(['ApiKey', 'SessionCookie']);

    for (const op of allOperations) {
      for (const req of op.security) {
        for (const scheme of Object.keys(req)) {
          expect(knownSchemes.has(scheme)).toBe(true);
        }
      }
    }
  });

  it('only uses known ApiKey permissions', () => {
    const knownPermissions = new Set(['READ_MEDIA', 'ADD_MEDIA', 'UPDATE_MEDIA', 'REMOVE_MEDIA']);

    for (const op of allOperations) {
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

    for (const op of allOperations) {
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
    const adminOps = allOperations.filter((op) => op.path.startsWith('/v1/admin/'));
    expect(adminOps.length).toBeGreaterThan(0);

    for (const op of adminOps) {
      const sessionReq = op.security.find((s) => 'SessionCookie' in s);
      expect(sessionReq).toBeDefined();
      expect(sessionReq?.SessionCookie).toContain('ADMIN');
    }
  });

  it('all user routes are session-only', () => {
    const userOps = allOperations.filter((op) => op.path.startsWith('/v1/user/'));
    expect(userOps.length).toBeGreaterThan(0);

    for (const op of userOps) {
      expect(op.security).toHaveLength(1);
      expect(op.security[0]).toHaveProperty('SessionCookie');
      expect(op.security[0].SessionCookie).toEqual([]);
    }
  });

  it('all collection routes are session-only', () => {
    const collectionOps = allOperations.filter((op) => op.path.startsWith('/v1/collections'));
    expect(collectionOps.length).toBeGreaterThan(0);

    for (const op of collectionOps) {
      expect(op.security).toHaveLength(1);
      expect(op.security[0]).toHaveProperty('SessionCookie');
      expect(op.security[0].SessionCookie).toEqual([]);
    }
  });

  it('all search routes require ApiKey READ_MEDIA', () => {
    const searchOps = allOperations.filter((op) => op.path.startsWith('/v1/search'));
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
        if (SKIPPED_OPERATIONS.has(operation.operationId ?? '')) continue;
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
});
