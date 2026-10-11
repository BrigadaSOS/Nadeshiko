/** Shared, ordered OpenAPI operation parsing for backend generators. Keeping security resolution here prevents
 * route-auth and proxy allowlists from interpreting one operation differently; policy remains in each consumer. */
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
  /** Marks routes reachable by the frontend server only, never by a browser, because the proxy’s internal-secret
   * header cannot distinguish relayed browser traffic. */
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
  /** Preserves operation-level `security` verbatim: `undefined` means no block, distinct from an explicit empty
   * list. Path/root security is currently absent and would require both consumers to change. */
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

/** Resolves a JSON `$ref`; a missing segment returns `undefined` so stale references fail as absent during
 * generation. */
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
