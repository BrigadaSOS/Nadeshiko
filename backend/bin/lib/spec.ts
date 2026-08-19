/**
 * Shared parsing of the bundled OpenAPI spec for the backend code generators.
 *
 * Three generators read the same bundle. Two of them read the same `security`
 * field to make decisions that must agree:
 *
 *   generateRouteAuth    — derives the API's own auth middleware
 *   generatePublicRoutes — derives the frontend proxy's master-key allowlist
 *
 * The master key belongs to the admin service account, so a route the proxy
 * injects it into is a route an anonymous browser reaches as that account. If
 * the two generators ever disagreed about how to read one security block — a
 * scheme name spelled differently, a missing scope list handled differently —
 * the proxy could inject the key on a route the middleware treats as
 * owner-scoped and hand the service account's data to the browser. They walk
 * the spec through this module so there is one reading of it, not three.
 *
 * Deriving *policy* from an operation stays with each generator; this module
 * only resolves the spec into a flat, ordered operation list.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';

export const BUNDLED_SPEC = resolve(import.meta.dirname, '../../docs/generated/openapi.yaml');

/** The HTTP methods the API uses. Path items carry no other operation keys. */
export const HTTP_METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface SecurityRequirement {
  [scheme: string]: string[];
}

export interface OpenApiOperation {
  operationId?: string;
  security?: SecurityRequirement[];
  tags?: string[];
  responses?: Record<string, unknown>;
  'x-internal'?: boolean;
  /**
   * Reachable by our own frontend SERVER only, never by a browser -- even the
   * signed-in reader's own, even through the site's `/v1` proxy. The proxy
   * stamps every request it forwards with the internal secret, so a controller
   * checking that secret cannot tell a server-side call from a browser call the
   * proxy relayed; this marker is what generates the proxy's refusal.
   */
  'x-server-only'?: boolean;
}

export type PathItem = Partial<Record<HttpMethod, OpenApiOperation>>;

export interface OpenApiSpec {
  paths: Record<string, PathItem>;
  components?: Record<string, unknown>;
}

/** One operation, resolved out of the nested path-item structure. */
export interface SpecOperation {
  /** Absent only in a malformed spec; callers decide whether that is fatal. */
  operationId: string | undefined;
  method: HttpMethod;
  /** OpenAPI form, with `{param}` templates: `/v1/media/{mediaId}`. */
  path: string;
  /** Express form, with `:param`: `/v1/media/:mediaId`. */
  expressPath: string;
  /**
   * The operation's own `security` block, verbatim. `undefined` means the
   * operation declares none — which is not the same as declaring an empty
   * list, so callers can tell "no block" from "explicitly unguarded".
   *
   * Only operation-level security is read: the bundle sets no path-level or
   * root-level `security`, and every consumer here assumes that. Introducing
   * either would need this resolution — and both consumers — revisited.
   */
  security: SecurityRequirement[] | undefined;
  tags: string[];
  isInternal: boolean;
  isServerOnly: boolean;
  /** The raw operation, for consumers that need fields beyond the above. */
  operation: OpenApiOperation;
}

export function openApiPathToExpress(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}

export function loadBundledSpec(specPath: string = BUNDLED_SPEC): OpenApiSpec {
  return parse(readFileSync(specPath, 'utf8')) as OpenApiSpec;
}

/**
 * Flatten a spec's paths into an operation list, in spec order: each path in
 * document order, and within a path the methods in `HTTP_METHODS` order.
 */
export function listOperations(spec: Pick<OpenApiSpec, 'paths'>): SpecOperation[] {
  const operations: SpecOperation[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const expressPath = openApiPathToExpress(path);

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      operations.push({
        operationId: operation.operationId,
        method,
        path,
        expressPath,
        security: operation.security,
        tags: operation.tags ?? [],
        isInternal: Boolean(operation['x-internal']),
        isServerOnly: Boolean(operation['x-server-only']),
        operation,
      });
    }
  }

  return operations;
}

/**
 * Chase a JSON `$ref` pointer through the spec. Returns undefined if any
 * segment is missing, so a stale ref surfaces as absent rather than as a throw
 * halfway through generation.
 */
export function resolveRef<T = unknown>(spec: OpenApiSpec, ref: string): T | undefined {
  const parts = ref.replace(/^#\//, '').split('/');
  let current: unknown = spec;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current as T;
}
