#!/usr/bin/env node
/**
 * Post-generation script for the internal Nadeshiko SDK
 *
 * This script runs after openapi-ts to:
 * 1. Generate the client factory (createNadeshikoClient)
 * 2. Create internal namespace exports organized by tag group
 *
 * Only the internal SDK is built here — the npm package external users install
 * is built by the separate nadeshiko-sdk-ts repository, which carries its own
 * copy of this generator. See README.md.
 */

import { copyFileSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, '..');
const GENERATED_DIR = join(ROOT_DIR, 'generated', 'internal');

const ROOT_PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'));
const SDK_VERSION = process.env.SDK_VERSION?.trim() || ROOT_PACKAGE_JSON.version || '0.0.0';

// Defaults to the backend's bundled spec in this monorepo, so codegen needs no
// configuration. Override to generate against a published or remote spec.
const OPENAPI_SPEC_SOURCE =
  process.env.OPENAPI_SPEC_PATH?.trim() || '../../backend/docs/generated/openapi.yaml';

type PaginationDetection = {
  /** The response property that holds the array of items (e.g. "segments", "media") */
  itemsField: string;
};

type PathParamInfo = {
  name: string;
  schemaType: 'string' | 'number';
};

type ParamLayout = 'body-only' | 'query-only' | 'path-only' | 'path-and-query' | 'body-and-path' | 'none';

type EndpointInfo = {
  operationId: string;
  tag: string;
  path: string;
  method: string;
  isInternal: boolean;
  pagination: PaginationDetection | null;
  pathParams: PathParamInfo[];
  hasRequiredBody: boolean;
  hasRequiredQuery: boolean;
  hasBody: boolean;
  hasQuery: boolean;
  paramLayout: ParamLayout;
};

/**
 * Convert operationId to generated type prefix.
 * Example: search => Search, getQueueStats => GetQueueStats
 */
function operationTypePrefix(operationId: string): string {
  return `${operationId.charAt(0).toUpperCase()}${operationId.slice(1)}`;
}

function getAvailableGeneratedTypeNames(): Set<string> {
  const typesFilePath = join(GENERATED_DIR, 'types.gen.ts');
  const source = readFileSync(typesFilePath, 'utf-8');
  const names = new Set<string>();

  for (const match of source.matchAll(/export\s+type\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s+interface\s+([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }

  return names;
}

/**
 * Get the group name for a tag (used for internal namespace organization)
 */
function getGroupName(tag: string): string {
  const normalized = tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'default';
}

/**
 * Chase a JSON `$ref` pointer through a parsed OpenAPI document.
 */
function resolveRef(spec: any, ref: string): any {
  const parts = ref.replace(/^#\//, '').split('/');
  let current = spec;
  for (const part of parts) {
    current = current?.[part];
  }
  return current;
}

/**
 * Resolve a value that may be a `$ref` to the actual schema object.
 */
function maybeResolve(spec: any, value: any): any {
  if (value && typeof value === 'object' && '$ref' in value) {
    return resolveRef(spec, value.$ref);
  }
  return value;
}

/**
 * Detect pagination info from a 200 response schema.
 * Returns the items field name if the schema has a `pagination` property
 * referencing PaginationInfo or OpaqueCursorPagination, and a sibling array property.
 */
function detectPagination(spec: any, operation: any): PaginationDetection | null {
  // Support x-paginated-items extension as explicit override
  if (operation['x-paginated-items']) {
    return { itemsField: operation['x-paginated-items'] };
  }

  const response200 = operation.responses?.['200'];
  if (!response200) return null;

  const resolved200 = maybeResolve(spec, response200);
  const schemaRef = resolved200?.content?.['application/json']?.schema;
  if (!schemaRef) return null;

  const schema = maybeResolve(spec, schemaRef);
  if (!schema?.properties) return null;

  return detectPaginationInSchema(spec, schema);
}

function detectPaginationInSchema(spec: any, schema: any): PaginationDetection | null {
  const props = schema.properties;
  if (!props) return null;

  // Check if there's a `pagination` property
  const paginationProp = props.pagination;
  if (!paginationProp) return null;

  // Verify it references PaginationInfo or OpaqueCursorPagination
  const paginationRef = paginationProp.$ref ?? '';
  const resolvedPag = maybeResolve(spec, paginationProp);
  const isPagination = paginationRef.includes('PaginationInfo')
    || paginationRef.includes('OpaqueCursorPagination')
    || (resolvedPag?.properties?.hasMore && resolvedPag?.properties?.cursor);

  if (!isPagination) return null;

  // Find the sibling array property — that's the items field
  for (const [key, value] of Object.entries(props)) {
    if (key === 'pagination') continue;
    const resolved = maybeResolve(spec, value as any);
    if (resolved?.type === 'array') {
      return { itemsField: key };
    }
  }

  return null;
}

/**
 * Extract path parameters from an operation and its path item.
 */
function extractPathParams(pathItemParams: any[] | undefined, operationParams: any[] | undefined, spec: any): PathParamInfo[] {
  const allParams = [...(pathItemParams ?? []), ...(operationParams ?? [])];
  const result: PathParamInfo[] = [];
  const seen = new Set<string>();

  // Operation params override path-level params (iterate in reverse priority)
  for (const param of allParams) {
    const resolved = maybeResolve(spec, param);
    if (resolved?.in !== 'path') continue;
    if (seen.has(resolved.name)) continue;
    seen.add(resolved.name);

    const schemaType = resolved.schema?.type === 'integer' || resolved.schema?.type === 'number'
      ? 'number' as const
      : 'string' as const;
    result.push({ name: resolved.name, schemaType });
  }

  return result;
}

/**
 * Check if an operation has any required query parameters.
 */
function hasRequiredQueryParams(pathItemParams: any[] | undefined, operationParams: any[] | undefined, spec: any): boolean {
  const allParams = [...(pathItemParams ?? []), ...(operationParams ?? [])];
  return allParams.some(p => {
    const resolved = maybeResolve(spec, p);
    return resolved?.in === 'query' && resolved?.required === true;
  });
}

/**
 * Get absolute path for the OpenAPI spec
 */
function getOpenApiSpecPath(): string {
  if (OPENAPI_SPEC_SOURCE.startsWith('http://') || OPENAPI_SPEC_SOURCE.startsWith('https://')) {
    return OPENAPI_SPEC_SOURCE;
  }
  // Convert to absolute path
  return OPENAPI_SPEC_SOURCE.startsWith('/')
    ? OPENAPI_SPEC_SOURCE
    : join(ROOT_DIR, OPENAPI_SPEC_SOURCE);
}

/**
 * Load OpenAPI spec from either a URL or local file path
 */
async function loadOpenApiSpec(): Promise<any> {
  const specPath = getOpenApiSpecPath();
  if (specPath.startsWith('http://') || specPath.startsWith('https://')) {
    // Fetch from URL
    console.log(`Fetching OpenAPI spec from: ${specPath}`);
    const response = await fetch(specPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.statusText}`);
    }
    const text = await response.text();
    return parse(text);
  } else {
    // Read from local file path
    console.log(`Reading OpenAPI spec from: ${specPath}`);
    return parse(readFileSync(specPath, 'utf-8'));
  }
}

/**
 * Parse the OpenAPI spec and categorize endpoints
 */
async function parseOpenApiSpec(): Promise<{
  public: EndpointInfo[];
  internal: EndpointInfo[];
  internalByGroup: Record<string, string[]>;
}> {
  const spec = await loadOpenApiSpec();
  const publicEndpoints: EndpointInfo[] = [];
  const internalEndpoints: EndpointInfo[] = [];
  const internalByGroup: Record<string, string[]> = {};

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem as any)) {
      if (method === 'parameters' || method === '$ref') continue;
      const operationObj = operation as Record<string, any>;
      if (!operationObj || !operationObj.operationId) continue;

      const pathItemObj = pathItem as any;
      const tags = Array.isArray(operationObj.tags) && operationObj.tags.length > 0
        ? operationObj.tags.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
        : ['Search'];
      const tag = tags[0] || 'Search';
      const isInternal = Boolean(operationObj['x-internal']);
      const groupName = getGroupName(tag);

      const pathItemParams = Array.isArray(pathItemObj.parameters) ? pathItemObj.parameters : undefined;
      const operationParams = Array.isArray(operationObj.parameters) ? operationObj.parameters : undefined;

      const epPathParams = extractPathParams(pathItemParams, operationParams, spec);
      const hasBody = !!operationObj.requestBody;
      const allParams = [...(pathItemParams ?? []), ...(operationParams ?? [])];
      const hasQuery = allParams.some(p => maybeResolve(spec, p)?.in === 'query');
      const hasPath = epPathParams.length > 0;

      let paramLayout: ParamLayout;
      if (hasBody && !hasPath && !hasQuery) paramLayout = 'body-only';
      else if (hasQuery && !hasPath && !hasBody) paramLayout = 'query-only';
      else if (hasPath && !hasBody && !hasQuery) paramLayout = 'path-only';
      else if (hasPath && !hasBody) paramLayout = 'path-and-query';
      else if (hasBody && hasPath && !hasQuery) paramLayout = 'body-and-path';
      else if (!hasBody && !hasPath && !hasQuery) paramLayout = 'none';
      else paramLayout = 'body-only'; // fallback

      // hasRequiredBody: true only when body is required AND the schema has at least
      // one required property. Bodies where all fields are optional (e.g. SearchRequest)
      // are treated as optional so callers can omit params entirely.
      const bodySchema = operationObj.requestBody?.content?.['application/json']?.schema;
      const resolvedBodySchema = bodySchema ? maybeResolve(spec, bodySchema) : null;
      const bodyHasRequiredProps = Array.isArray(resolvedBodySchema?.required) && resolvedBodySchema.required.length > 0;
      const hasRequiredBody = operationObj.requestBody?.required === true && bodyHasRequiredProps;

      const endpointInfo: EndpointInfo = {
        operationId: operationObj.operationId,
        tag,
        path,
        method,
        isInternal,
        pagination: detectPagination(spec, operationObj),
        pathParams: epPathParams,
        hasRequiredBody,
        hasRequiredQuery: hasRequiredQueryParams(pathItemParams, operationParams, spec),
        hasBody,
        hasQuery,
        paramLayout,
      };

      if (isInternal) {
        internalEndpoints.push(endpointInfo);
        if (!internalByGroup[groupName]) {
          internalByGroup[groupName] = [];
        }
        internalByGroup[groupName].push(endpointInfo.operationId);
      } else {
        publicEndpoints.push(endpointInfo);
      }
    }
  }

  return { public: publicEndpoints, internal: internalEndpoints, internalByGroup };
}

/**
 * Check if an endpoint qualifies for a string/number shorthand overload.
 * Must have exactly 1 path param and no required body or query params.
 */
function getShorthandParam(ep: EndpointInfo): PathParamInfo | null {
  if (ep.pathParams.length !== 1) return null;
  if (ep.hasRequiredBody) return null;
  if (ep.hasRequiredQuery) return null;
  return ep.pathParams[0];
}

/**
 * Generate the runtime repacking code that converts flat params → { body, path, query } for the raw SDK call.
 * Returns lines to insert inside the wrapper function body (after `const params = ...`).
 */
function buildRepackExpression(fn: string, ep: EndpointInfo): string {
  switch (ep.paramLayout) {
    case 'body-only':
      return [
        `    const { throwOnError: tOE, ...body } = params ?? {};`,
        `    const p = ${fn}({ ...(Object.keys(body).length > 0 ? { body } : {}), client: clientInstance, throwOnError: tOE === false ? false : true } as any);`,
      ].join('\n');

    case 'query-only':
      return [
        `    const { throwOnError: tOE, ...query } = params ?? {};`,
        `    const p = ${fn}({ ...(Object.keys(query).length > 0 ? { query } : {}), client: clientInstance, throwOnError: tOE === false ? false : true } as any);`,
      ].join('\n');

    case 'path-only': {
      const destructure = ep.pathParams.map(p => p.name).join(', ');
      const pathObj = ep.pathParams.map(p => p.name).join(', ');
      return [
        `    const { throwOnError: tOE, ${destructure} } = params ?? {};`,
        `    const p = ${fn}({ path: { ${pathObj} }, client: clientInstance, throwOnError: tOE === false ? false : true } as any);`,
      ].join('\n');
    }

    case 'path-and-query': {
      const destructure = ep.pathParams.map(p => p.name).join(', ');
      const pathObj = ep.pathParams.map(p => p.name).join(', ');
      return [
        `    const { throwOnError: tOE, ${destructure}, ...query } = params ?? {};`,
        `    const p = ${fn}({ path: { ${pathObj} }, ...(Object.keys(query).length > 0 ? { query } : {}), client: clientInstance, throwOnError: tOE === false ? false : true } as any);`,
      ].join('\n');
    }

    case 'body-and-path': {
      const destructure = ep.pathParams.map(p => p.name).join(', ');
      const pathObj = ep.pathParams.map(p => p.name).join(', ');
      return [
        `    const { throwOnError: tOE, ${destructure}, ...body } = params ?? {};`,
        `    const p = ${fn}({ path: { ${pathObj} }, ...(Object.keys(body).length > 0 ? { body } : {}), client: clientInstance, throwOnError: tOE === false ? false : true } as any);`,
      ].join('\n');
    }

    case 'none':
      return [
        `    const tOE = params?.throwOnError;`,
        `    const p = ${fn}({ client: clientInstance, throwOnError: tOE === false ? false : true } as any);`,
      ].join('\n');
  }
}

/**
 * Generate the repacking expression for the .paginate callback.
 * Inside the flatPaginate callback, `flat` contains the flat params with cursor merged in.
 */
function buildPaginateRepackExpression(fn: string, ep: EndpointInfo): string {
  switch (ep.paramLayout) {
    case 'body-only':
      return `      return ${fn}({ body: flat, client: clientInstance } as any);`;

    case 'query-only':
      return `      return ${fn}({ query: flat, client: clientInstance } as any);`;

    case 'path-only': {
      const pathObj = ep.pathParams.map(p => `${p.name}: flat.${p.name}`).join(', ');
      return `      return ${fn}({ path: { ${pathObj} }, client: clientInstance } as any);`;
    }

    case 'path-and-query': {
      const destructure = ep.pathParams.map(p => p.name).join(', ');
      const pathObj = ep.pathParams.map(p => p.name).join(', ');
      return [
        `      const { ${destructure}, ...q } = flat;`,
        `      return ${fn}({ path: { ${pathObj} }, query: q, client: clientInstance } as any);`,
      ].join('\n');
    }

    case 'body-and-path': {
      const destructure = ep.pathParams.map(p => p.name).join(', ');
      const pathObj = ep.pathParams.map(p => p.name).join(', ');
      return [
        `      const { ${destructure}, ...body } = flat;`,
        `      return ${fn}({ path: { ${pathObj} }, body, client: clientInstance } as any);`,
      ].join('\n');
    }

    case 'none':
      return `      return ${fn}({ client: clientInstance } as any);`;
  }
}

/**
 * Build the TypeScript type expression for flattened parameters of an endpoint.
 * Instead of `{ body: SearchRequest }` the user passes `SearchRequest` fields directly.
 */
function flatParamType(prefix: string, ep: EndpointInfo): string {
  switch (ep.paramLayout) {
    case 'body-only':
      return `NonNullable<Types.${prefix}Data['body']>`;
    case 'query-only':
      return `NonNullable<Types.${prefix}Data['query']>`;
    case 'path-only':
      return `Types.${prefix}Data['path']`;
    case 'path-and-query':
      return `Types.${prefix}Data['path'] & NonNullable<Types.${prefix}Data['query']>`;
    case 'body-and-path':
      return `Types.${prefix}Data['path'] & NonNullable<Types.${prefix}Data['body']>`;
    case 'none':
      return '{}';
  }
}

/**
 * Generate the client factory file
 */
function generateClientFactory(endpoints: EndpointInfo[], availableTypeNames: Set<string>): string {
  const operationIds = endpoints.map(e => e.operationId);
  const sdkImports = operationIds.join(', ');

  // Build the return type with flat parameter overloads per method:
  //   • shorthand (string)   → direct return (single path param endpoints only)
  //   • throwOnError: false  → union return with envelope (caller must check data vs error)
  //   • default / true       → unwrapped Promise<Response> (throws on error)
  //   • .paginate            → async generator (paginated endpoints only)
  const returnTypeParts = endpoints.map(ep => {
    const fn = ep.operationId;
    const prefix = operationTypePrefix(fn);
    const hasData = availableTypeNames.has(`${prefix}Data`);
    const hasResponse = availableTypeNames.has(`${prefix}Response`);

    if (hasData && hasResponse) {
      const errorType = availableTypeNames.has(`${prefix}Errors`)
        ? `Types.${prefix}Errors`
        : 'unknown';
      const envelope = `{ data: Types.${prefix}Response; response: Response; request: Request }`;
      const shorthand = getShorthandParam(ep);
      const paramType = flatParamType(prefix, ep);

      const overloads: string[] = [];

      // Shorthand overload: client.getMedia('some-id')
      if (shorthand) {
        overloads.push(`      (id: ${shorthand.schemaType}): Promise<Types.${prefix}Response>;`);
      }

      // throwOnError: false overload — keeps the full envelope
      const throwOnErrorParamType = ep.paramLayout === 'none' ? '{ throwOnError: false }' : `${paramType} & { throwOnError: false }`;
      overloads.push(`      (params: ${throwOnErrorParamType}): Promise<${envelope} | { error: ${errorType}; response: Response; request: Request }>;`);

      // Default overload — unwrapped data
      if (ep.paramLayout === 'none') {
        overloads.push(`      (): Promise<Types.${prefix}Response>;`);
      } else {
        overloads.push(`      (params${ep.hasRequiredBody || (ep.pathParams.length > 0) ? '' : '?'}: ${paramType}): Promise<Types.${prefix}Response>;`);
      }

      // .paginate property for paginated endpoints
      let paginateProp = '';
      if (ep.pagination) {
        paginateProp = `\n      paginate: (params?: ${paramType}) => AsyncGenerator<Types.${prefix}Response['${ep.pagination.itemsField}'][number], void, unknown>;`;
      }

      return `    ${fn}: {
${overloads.join('\n')}${paginateProp}
    };`;
    }
    return `    ${fn}: typeof ${fn};`;
  });

  const returnType = `export type NadeshikoClient = {
    client: Client;
${returnTypeParts.join('\n')}
  };`;

  // Build the bound function definitions and return object entries.
  // Each method: repacks flat params into { body, path, query } for the raw SDK function,
  // unwraps data by default, keeps envelope for throwOnError: false,
  // supports string shorthand, and has .paginate for paginated endpoints.
  const functionDefs: string[] = [];
  const returnObjEntries: string[] = [];

  for (const ep of endpoints) {
    const fn = ep.operationId;
    const shorthand = getShorthandParam(ep);
    const isPaginated = ep.pagination !== null;

    // Generate the repacking logic based on param layout
    const repackExpr = buildRepackExpression(fn, ep);

    // All methods get a named function (needed for consistent .paginate attachment)
    const lines: string[] = [];

    if (shorthand) {
      lines.push(`  const _${fn} = (paramsOrId?: any) => {`);
      lines.push(`    if (typeof paramsOrId === '${shorthand.schemaType}') {`);
      lines.push(`      return ${fn}({ throwOnError: true, path: { ${shorthand.name}: paramsOrId }, client: clientInstance } as any).then((r: any) => r.data);`);
      lines.push(`    }`);
      lines.push(`    const params = paramsOrId;`);
    } else {
      lines.push(`  const _${fn} = (params?: any) => {`);
    }

    lines.push(repackExpr);
    lines.push(`    return tOE === false ? p : p.then((r: any) => r.data);`);
    lines.push(`  };`);

    if (isPaginated) {
      lines.push(`  _${fn}.paginate = (params?: any) => flatPaginate(`);
      lines.push(`    params ?? {},`);
      lines.push(`    (flat: any) => {`);
      lines.push(buildPaginateRepackExpression(fn, ep));
      lines.push(`    },`);
      lines.push(`    (data: any) => ({ items: data.${ep.pagination!.itemsField}, pagination: data.pagination }),`);
      lines.push(`  );`);
    }

    functionDefs.push(lines.join('\n'));
    returnObjEntries.push(`    ${fn}: _${fn},`);
  }

  const functionDefsBlock = functionDefs.length > 0 ? '\n' + functionDefs.join('\n\n') + '\n' : '';

  const hasPaginatedEndpoints = endpoints.some(ep => ep.pagination !== null);
  const paginateImport = hasPaginatedEndpoints
    ? `import { flatPaginate } from './paginate';\n`
    : '';

  return `// This file is auto-generated by scripts/generateInternal.ts

import { createClient as createApiClient, createConfig, type Client } from './client';
import type { Auth } from './core/auth.gen';
import type { ClientOptions } from './types.gen';
import type * as Types from './types.gen';
import { ${sdkImports}, type Options } from './sdk.gen';
import { withRetry, type RetryOptions } from './retry';
import { NadeshikoError, buildNadeshikoError, isProblemDetails, type NadeshikoErrorCode, type RateLimitReason } from './errors';
${paginateImport}
type ApiKeyProvider = string | (() => string | undefined | Promise<string | undefined>);

export interface NadeshikoConfig {
  /**
   * API key for Bearer token authentication.
   * Used for API key protected endpoints.
   */
  apiKey?: ApiKeyProvider;
  /**
   * A function that returns the session token for cookie-based authentication.
   * Used for session-protected endpoints (e.g. /v1/user/* and /v1/collections/*).
   * Defaults to reading the \`nadeshiko.session_token\` cookie from \`document.cookie\`.
   */
  sessionToken?: () => string | undefined | Promise<string | undefined>;
  /**
   * Base URL of the Nadeshiko API. Accepts \`'LOCAL'\`, \`'DEVELOPMENT'\`, \`'STAGING'\`,
   * \`'PRODUCTION'\`, \`'PROXY'\`, or a custom URL string. \`'PROXY'\` resolves to an empty
   * base URL so requests stay same-origin and land on a caller-supplied proxy.
   */
  baseURL?: 'LOCAL' | 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION' | 'PROXY' | string;
  /** @deprecated Use \`baseURL\` instead */
  baseUrl?: 'LOCAL' | 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION' | 'PROXY' | string;
  /** Retry configuration for failed requests. Retries on network errors and 408/429/5xx responses. */
  retryOptions?: RetryOptions;
  /** Default headers sent with every request (e.g. User-Agent, tracing headers). */
  headers?: Record<string, string>;
}

const environments = {
  LOCAL: 'http://localhost:5000',
  DEVELOPMENT: 'https://api-stg.nadeshiko.co',
  STAGING: 'https://api-stg.nadeshiko.co',
  PRODUCTION: 'https://api.nadeshiko.co',
  PROXY: '',
} as const;

${returnType}

const defaultSessionTokenGetter = (): string | undefined => {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(/(?:^|;\\s*)nadeshiko\\.session_token=([^;]*)/);
  return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
};


export function createNadeshikoClient(config: NadeshikoConfig): NadeshikoClient {
  const rawBaseUrl = config.baseURL ?? config.baseUrl;
  const baseUrl = rawBaseUrl === undefined
    ? environments.PRODUCTION
    : (rawBaseUrl in environments
        ? environments[rawBaseUrl as keyof typeof environments]
        : rawBaseUrl);

  const getApiKey = async (): Promise<string | undefined> => {
    if (typeof config.apiKey === 'function') {
      return await config.apiKey();
    }
    return config.apiKey;
  };

  const getSessionToken = config.sessionToken ?? defaultSessionTokenGetter;

  const clientInstance = createApiClient(createConfig<ClientOptions>({
    baseUrl,
    headers: { 'User-Agent': 'nadeshiko-sdk-ts/${SDK_VERSION}', ...config.headers },
    fetch: withRetry(globalThis.fetch, config.retryOptions) as typeof fetch,
    auth: (auth: Auth) => {
      if (auth.in === 'cookie') {
        return getSessionToken();
      }
      return getApiKey();
    },
  }));

  clientInstance.interceptors.error.use((error, response, request) => {
    // The query string is dropped: it carries the caller's search terms, and
    // keeping it would also scatter one fault across an issue per distinct URL.
    const requestUrl = request ? request.url.split('?')[0] : undefined;

    // Which limit fired, and the two numbers that say what to do about it.
    // They live in headers rather than the body because they also have to be
    // readable on the responses that SUCCEED -- the account page renders its
    // bar from the same fields -- and a header is the one place both cases
    // share. Undefined on anything that is not a 429 from a current deployment.
    const rateLimit = response
      ? {
          rateLimitReason: (response.headers.get('x-ratelimit-reason') as RateLimitReason | null) ?? undefined,
          retryAfterSeconds: Number(response.headers.get('retry-after')) || undefined,
          quotaResetsAt: response.headers.get('x-monthly-quota-reset') ?? undefined,
        }
      : {};

    if (isProblemDetails(error)) {
      return buildNadeshikoError({ requestUrl, ...rateLimit, ...error });
    }

    // NOT one of our problem documents. Everything below exists because the old
    // version of this branch dropped what the transport still knew and produced
    // \`NadeshikoError: API error undefined\` -- a message naming neither the
    // failure nor the endpoint, which is unactionable in error tracking.
    const body = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>;

    // \`response\` is undefined when the request never got one at all (network
    // drop, CORS, abort). That absence is itself the signal, so it is recorded
    // as status 0 rather than guessed at.
    const status = typeof body.status === 'number' ? body.status : (response?.status ?? 0);

    // better-auth answers with \`{ code, message }\`, which is the shape that used
    // to fall through here; \`message\` is checked so those read as themselves.
    const detail = [body.detail, body.message, body.error, response?.statusText].find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );

    return buildNadeshikoError({
      code: typeof body.code === 'string' ? (body.code as NadeshikoErrorCode) : 'UNKNOWN_ERROR',
      title: 'Unexpected error',
      detail: detail ?? (status > 0 ? \`HTTP \${status}\` : 'Request failed before a response arrived'),
      status,
      requestUrl,
      ...rateLimit,
    });
  });
${functionDefsBlock}
  return {
    client: clientInstance,
${returnObjEntries.join('\n')}
  } as NadeshikoClient;
}

`;
}

/**
 * Generate errors.ts with a NadeshikoErrorCode union derived from the generated error types.
 */
function generateErrorsFile(availableTypeNames: Set<string>): string {
  const present = [...availableTypeNames].filter(name => /^Error\d+$/.test(name));

  const imports = present.length > 0
    ? `import type { ${present.join(', ')} } from './types.gen';\n\n`
    : '';
  const codeUnion = present.length > 0
    ? present.map(t => `${t}['code']`).join(' | ') + " | 'UNKNOWN_ERROR'"
    : 'string';

  return `// This file is auto-generated by scripts/generateInternal.ts
${imports}/** Union of all known API error codes. */
export type NadeshikoErrorCode = ${codeUnion};

export interface NadeshikoProblemDetails {
  code: NadeshikoErrorCode;
  title: string;
  detail: string;
  type?: string;
  /** Trace ID for this specific error occurrence — include when reporting issues */
  instance?: string;
  status: number;
  /** Per-field validation messages, present when \`code\` is \`'VALIDATION_FAILED'\` */
  errors?: Record<string, string>;
  /**
   * Endpoint the failing request was sent to, minus its query string. An RFC 7807
   * extension member, set by the SDK rather than the API, so that a caught error
   * says which call produced it without the caller having to thread that through.
   */
  requestUrl?: string;
  /**
   * Which limit produced a 429, read from the \`X-RateLimit-Reason\` response
   * header. Absent on every other status, and on 429s from a deployment older
   * than the header.
   */
  rateLimitReason?: RateLimitReason;
  /** \`Retry-After\`, in seconds, when the response carried one. */
  retryAfterSeconds?: number;
  /** \`X-Monthly-Quota-Reset\`: when the monthly allowance next refills. */
  quotaResetsAt?: string;
}

/**
 * Which limit rejected a request.
 *
 * All four answer 429 and they need opposite handling: the three bursts clear
 * on their own within the window, and the month does not move until the 1st.
 * Retrying a monthly cap spends a backoff budget against a wall.
 */
export type RateLimitReason = 'monthly_quota' | 'key_burst' | 'key_usage' | 'ip_burst';

/**
 * Whether a response body is one of our Problem Details documents.
 *
 * Both fields are required deliberately. Matching on \`code\` alone also matched
 * better-auth's \`{ code, message }\` errors, and because those carry no \`status\`,
 * \`title\` or \`detail\`, every field on the resulting error came out undefined --
 * the origin of the \`API error undefined\` issues in error tracking.
 */
export function isProblemDetails(value: unknown): value is NadeshikoProblemDetails {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.code === 'string' && typeof body.status === 'number';
}

/**
 * Thrown by the SDK when the API returns a non-2xx response.
 *
 * All fields from the RFC 7807 Problem Details response body are
 * available directly on the error instance.
 *
 * @example
 * \`\`\`ts
 * import { NadeshikoError } from '@brigadasos/nadeshiko-sdk';
 *
 * try {
 *   const { data } = await client.search({ body: { query: { search: '猫' } } });
 * } catch (err) {
 *   if (err instanceof NadeshikoError) {
 *     console.error(err.code);    // 'RATE_LIMIT_EXCEEDED'
 *     console.error(err.status);  // 429
 *     console.error(err.traceId); // trace ID for support
 *   }
 * }
 * \`\`\`
 */
export class NadeshikoError extends Error {
  readonly code: NadeshikoErrorCode;
  readonly title: string;
  readonly detail: string;
  readonly type?: string;
  readonly status: number;
  /** Trace ID from \`instance\` field — include when reporting issues */
  readonly traceId?: string;
  /** Per-field validation messages, present when \`code === 'VALIDATION_FAILED'\` */
  readonly errors?: Record<string, string>;
  /** Endpoint this error came from, minus its query string. */
  readonly requestUrl?: string;
  /** Which limit produced a 429; see \`RateLimitReason\`. Absent otherwise. */
  readonly rateLimitReason?: RateLimitReason;
  /** \`Retry-After\` in seconds, when the response carried one. */
  readonly retryAfterSeconds?: number;

  constructor(body: NadeshikoProblemDetails) {
    // \`status\` is never interpolated unguarded: a body that reached here without
    // one used to render as the message \`API error undefined\`, which named
    // neither the failure nor the endpoint.
    super(
      body.detail
      || body.title
      || (typeof body.status === 'number' ? \`API error \${body.status}\` : 'API error with no status'),
    );
    this.name = 'NadeshikoError';
    this.code = body.code;
    this.title = body.title;
    this.detail = body.detail;
    this.type = body.type;
    this.status = body.status;
    this.traceId = body.instance;
    this.errors = body.errors;
    this.requestUrl = body.requestUrl;
    this.rateLimitReason = body.rateLimitReason;
    this.retryAfterSeconds = body.retryAfterSeconds;
  }
}

/**
 * A 429 that waiting will clear: a per-key or per-IP burst, or a key's
 * remaining-uses budget between refills.
 *
 * \`retryAfterSeconds\` is the server's own answer to "how long" when it sent
 * one. Back off and retry.
 */
export class RateLimitExceededError extends NadeshikoError {
  /** Always one of the burst reasons; never \`'monthly_quota'\`. */
  declare readonly rateLimitReason: Exclude<RateLimitReason, 'monthly_quota'>;

  constructor(body: NadeshikoProblemDetails) {
    super(body);
    this.name = 'RateLimitExceededError';
  }
}

/**
 * A 429 that waiting will NOT clear: the account has spent its monthly
 * allowance, and nothing moves until the period rolls over.
 *
 * Stop rather than retry. \`resetsAt\` is when it is worth trying again; a
 * higher allowance before then is a support conversation, not a backoff.
 *
 * @example
 * \`\`\`ts
 * try {
 *   await client.search({ body: { query: { search: '猫' } } });
 * } catch (err) {
 *   if (err instanceof MonthlyQuotaExceededError) {
 *     stopPolling(); // retrying cannot help before err.resetsAt
 *   } else if (err instanceof RateLimitExceededError) {
 *     await sleep((err.retryAfterSeconds ?? 60) * 1000);
 *   }
 * }
 * \`\`\`
 */
export class MonthlyQuotaExceededError extends NadeshikoError {
  declare readonly rateLimitReason: 'monthly_quota';
  /** When the allowance refills, if the response said so. */
  readonly resetsAt?: Date;

  constructor(body: NadeshikoProblemDetails) {
    super(body);
    this.name = 'MonthlyQuotaExceededError';
    this.resetsAt = body.quotaResetsAt ? new Date(body.quotaResetsAt) : undefined;
  }
}

/**
 * Builds the most specific error the response supports.
 *
 * Keyed on \`X-RateLimit-Reason\` rather than on the problem-details \`code\`,
 * because \`code\` cannot make the distinction that matters: \`QUOTA_EXCEEDED\`
 * covers both the account's month and a single key's refill budget, which are
 * "stop" and "wait" respectively. A deployment that does not send the header
 * yields the base \`NadeshikoError\`, exactly as before.
 */
export function buildNadeshikoError(body: NadeshikoProblemDetails): NadeshikoError {
  if (body.rateLimitReason === 'monthly_quota') return new MonthlyQuotaExceededError(body);
  if (body.rateLimitReason) return new RateLimitExceededError(body);
  return new NadeshikoError(body);
}
`;
}

/**
 * Generate internal namespace file with grouped exports
 */
function generateInternalNamespace(internalByGroup: Record<string, string[]>): string {
  // Create internal namespaces with direct imports.
  const directExports = Object.entries(internalByGroup)
    .map(([groupName]) => {
      return `export * as ${groupName} from './internal/${groupName}.gen';`;
    })
    .join('\n');

  return `// This file is auto-generated by scripts/generateInternal.ts
// Internal endpoints - organized by tag group (like Python SDK's internal modules)

${directExports}
`;
}

/**
 * Generate group-specific internal files
 */
function generateInternalGroupFiles(internalByGroup: Record<string, string[]>): Array<{ name: string; content: string }> {
  return Object.entries(internalByGroup).map(([groupName, endpoints]) => {
    const exports = endpoints.join(', ');
    return {
      name: `internal/${groupName}.gen.ts`,
      content: `// This file is auto-generated by scripts/generateInternal.ts
// Internal endpoints for ${groupName.toUpperCase()} - for application use only

export { ${exports} } from '../sdk.gen';
`,
    };
  });
}

/**
 * Generate the internal index file.
 * NOTE: Internal SDK exposes all endpoint operations and all generated types.
 */
function generateInternalIndex(allEndpoints: EndpointInfo[], hasInternalGroups: boolean): string {
  const operationIds = allEndpoints.map(e => e.operationId);
  const exports = operationIds.join(', ');
  const internalGroupExports = hasInternalGroups
    ? `// Re-export grouped internal namespaces
export * from './internal.gen';

`
    : '';

  return `// This file is auto-generated by scripts/generateInternal.ts
// Internal SDK for backend services - includes public + internal endpoints

export { ${exports}, type Options } from './sdk.gen';

// Re-export client factory
export { createNadeshikoClient, type NadeshikoClient, type NadeshikoConfig } from './nadeshiko.gen';

// Re-export singleton client
export { client } from './client.gen';

${internalGroupExports}// Re-export all generated types
export * from './types.gen';
export type { Client, Config } from './client';

// Re-export helpers
export { paginate, flatPaginate, type PaginationMeta } from './paginate';
export { withRetry, type RetryOptions } from './retry';
export {
  NadeshikoError,
  MonthlyQuotaExceededError,
  RateLimitExceededError,
  type NadeshikoErrorCode,
  type NadeshikoProblemDetails,
  type RateLimitReason,
} from './errors';
`;
}

// Main execution
async function main() {
  try {
    // First run openapi-ts to generate all endpoints
    console.log('Running openapi-ts for internal SDK...');
    rmSync(GENERATED_DIR, { recursive: true, force: true });
    const { spawn } = await import('child_process');
    const specPath = getOpenApiSpecPath();
    await new Promise<void>((resolve, reject) => {
      // Use CLI arguments to pass the input source and output directory
      const proc = spawn('npx', ['openapi-ts', '-i', specPath, '-o', GENERATED_DIR], { stdio: 'inherit' });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`openapi-ts exited with code ${code}`)));
    });

    // Copy hand-written helpers into the generated directory
    copyFileSync(join(ROOT_DIR, 'src', 'retry.ts'), join(GENERATED_DIR, 'retry.ts'));
    copyFileSync(join(ROOT_DIR, 'src', 'paginate.ts'), join(GENERATED_DIR, 'paginate.ts'));
    console.log('✓ Copied src/retry.ts and src/paginate.ts into generated dir');

    // Parse the spec to get endpoint categorization
    console.log('Parsing OpenAPI spec...');
    const { public: publicEndpoints, internal: internalEndpoints, internalByGroup } = await parseOpenApiSpec();

    console.log(`Found ${publicEndpoints.length} public endpoints, ${internalEndpoints.length} internal endpoints`);
    const availableTypeNames = getAvailableGeneratedTypeNames();

    // Generate errors.ts with a typed NadeshikoErrorCode union
    const errorsContent = generateErrorsFile(availableTypeNames);
    writeFileSync(join(GENERATED_DIR, 'errors.ts'), errorsContent);
    console.log('✓ Generated errors.ts with NadeshikoErrorCode union');

    console.log(`Internal groups: ${Object.keys(internalByGroup).join(', ')}`);

    // The internal SDK includes both public and internal endpoints
    const allEndpoints = [...publicEndpoints, ...internalEndpoints];
    const clientFactoryContent = generateClientFactory(allEndpoints, availableTypeNames);
    writeFileSync(join(GENERATED_DIR, 'nadeshiko.gen.ts'), clientFactoryContent);
    console.log(`✓ Generated nadeshiko.gen.ts with ${allEndpoints.length} total endpoints`);

    // Generate internal group files
    if (Object.keys(internalByGroup).length > 0) {
      const groupFiles = generateInternalGroupFiles(internalByGroup);
      const internalDir = join(GENERATED_DIR, 'internal');
      await import('fs').then(fs => fs.promises.mkdir(internalDir, { recursive: true }));
      for (const file of groupFiles) {
        const groupName = file.name.split('/')[1].replace('.gen.ts', '');
        writeFileSync(join(GENERATED_DIR, file.name), file.content);
        console.log(`✓ Generated ${file.name} with ${internalByGroup[groupName].length} endpoints`);
      }

      // Generate internal namespace index
      const internalNamespaceContent = generateInternalNamespace(internalByGroup);
      writeFileSync(join(GENERATED_DIR, 'internal.gen.ts'), internalNamespaceContent);
      console.log(`✓ Generated internal.gen.ts`);
    }

    // Generate internal package index
    const internalIndexContent = generateInternalIndex(allEndpoints, Object.keys(internalByGroup).length > 0);
    writeFileSync(join(GENERATED_DIR, 'index.ts'), internalIndexContent);
    console.log(`✓ Generated index.ts (internal)`);

    console.log('Done!');
  } catch (error) {
    console.error('Error in generation script:', error);
    process.exit(1);
  }
}

main();
