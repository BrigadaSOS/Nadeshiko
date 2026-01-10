import { openApiToBruno } from '@usebruno/converters';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import * as yaml from 'js-yaml';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { auth } from '@lib/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OPENAPI_FILE = join(__dirname, '../docs/generated/openapi-internal.yaml');
const BRUNO_DIR = join(__dirname, '../docs/bruno');
const GENERATED_SUBFOLDER = '[Generated] API';
const GENERATED_DIR = join(BRUNO_DIR, GENERATED_SUBFOLDER);
const COLLECTION_NAME = 'Nadeshiko';

interface OpenAPISpec {
  openapi: string;
  info: any;
  servers?: any[];
  paths: any;
  components?: any;
  tags?: any[];
  security?: any[];
}

interface BrunoItem {
  uid?: string;
  name: string;
  type: 'http-request' | 'folder' | 'http';
  request?: any;
  items?: BrunoItem[];
  root?: any;
}

interface BetterAuthLikeOptions {
  disabledPaths?: string[];
  emailAndPassword?: {
    enabled?: boolean;
  };
}

interface BetterAuthRuntimeRoute {
  method: string;
  path: string;
  summary: string;
  cookieAuth: boolean;
}

const EMAIL_PASSWORD_ENDPOINT_PATHS = new Set([
  '/sign-in/email',
  '/sign-up/email',
  '/request-password-reset',
  '/reset-password/:token',
  '/reset-password',
  '/verify-password',
  '/change-password',
]);

const PUBLIC_BETTER_AUTH_ENDPOINT_PATHS = new Set([
  '/sign-in/social',
  '/ok',
  '/error',
]);

// Pre-request script for session cookie auth
const SESSION_COOKIE_PRE_REQUEST_SCRIPT = `const sessionToken = bru.getEnvVar("sessionToken");
if (sessionToken) {
  req.setHeader("Cookie", "nadeshiko.session_token=" + sessionToken);
}`;

function parseYamlFile(filePath: string): OpenAPISpec {
  const content = readFileSync(filePath, 'utf8');
  return yaml.load(content) as OpenAPISpec;
}

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').trim();
}

function writeBruFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function writeRequestBruFile(folderPath: string, item: BrunoItem, seq: number): void {
  if (item.type !== 'http-request') return;

  const request = item.request;
  const fileName = sanitizeName(item.name) + '.bru';
  const filePath = join(folderPath, fileName);

  let content = `meta {\n`;
  content += `  name: ${sanitizeName(item.name)}\n`;
  content += `  type: http\n`;
  content += `  seq: ${seq}\n`;
  content += `}\n\n`;

  const method = request.method?.toLowerCase() || 'get';
  content += `${method} {\n`;

  // Build URL with query parameters if they exist
  let urlWithParams = request.url;
  if (request.params && request.params.length > 0) {
    const queryString = request.params
      .filter((p: any) => p.value !== undefined && p.value !== null && p.value !== '')
      .map((p: any) => `${p.name}=${p.value}`)
      .join('&');
    if (queryString) {
      urlWithParams += `?${queryString}`;
    }
  }
  content += `  url: ${urlWithParams}\n`;

  const hasJsonBody = request.body?.mode === 'json' && request.body?.json;
  content += `  body: ${hasJsonBody ? 'json' : 'none'}\n`;

  if (request._isCookieAuth) {
    content += `  auth: none\n`;
  } else if (request.auth?.mode === 'inherit') {
    content += `  auth: inherit\n`;
  } else if (request.auth?.mode === 'apikey') {
    content += `  auth: apikey\n`;
  }

  content += `}\n\n`;

  // Headers section - skip cookie auth header for session-auth endpoints
  if (request.headers && request.headers.length > 0) {
    const filteredHeaders = request._isCookieAuth
      ? request.headers.filter((h: any) => !['access_token', 'nadeshiko.session_token', 'Cookie'].includes(h.name))
      : request.headers;

    if (filteredHeaders.length > 0) {
      content += `headers {\n`;
      for (const header of filteredHeaders) {
        content += `  ${header.name}: ${header.value}\n`;
      }
      content += `}\n\n`;
    }
  }

  if (request.params && request.params.length > 0) {
    content += `params:query {\n`;
    for (const param of request.params) {
      content += `  ${param.name}:`;
      if (param.value !== undefined && param.value !== null && param.value !== '') {
        content += ` ${param.value}`;
      }
      content += `\n`;
    }
    content += `}\n\n`;
  }

  // Only output auth:apikey block for non-cookie-auth endpoints
  if (request.auth?.mode === 'apikey' && !request._isCookieAuth) {
    const authKey =
      request.auth.apikey?.key === 'x-api-key' ? 'Authorization' : request.auth.apikey?.key || 'Authorization';
    const rawValue = String(request.auth.apikey?.value || 'apiKey');
    const wrappedValue = rawValue.startsWith('{{') ? rawValue : `{{${rawValue}}}`;
    const formattedValue =
      authKey === 'Authorization' && !wrappedValue.startsWith('Bearer ') ? `Bearer ${wrappedValue}` : wrappedValue;

    content += `auth:apikey {\n`;
    content += `  key: ${authKey}\n`;
    content += `  value: ${formattedValue}\n`;
    content += `  placement: ${request.auth.apikey?.placement || 'header'}\n`;
    content += `}\n\n`;
  }

  if (request.body?.mode === 'json' && request.body?.json) {
    content += `body:json {\n`;
    const bodyJson = request.body.json;
    let jsonContent: string;
    if (typeof bodyJson === 'string') {
      const parsed = JSON.parse(bodyJson);
      jsonContent = JSON.stringify(parsed, null, 2);
    } else {
      jsonContent = JSON.stringify(bodyJson, null, 2);
    }
    const lines = jsonContent.split('\n');
    for (const line of lines) {
      content += `  ${line}\n`;
    }
    content += `}\n\n`;
  }

  content += `settings {\n`;
  content += `  encodeUrl: true\n`;
  content += `  timeout: 0\n`;
  content += `}\n`;

  // Add pre-request script for cookie-auth endpoints
  if (request._isCookieAuth) {
    content += `\n`;
    content += `script:pre-request {\n`;
    const lines = SESSION_COOKIE_PRE_REQUEST_SCRIPT.split('\n');
    for (const line of lines) {
      content += `  ${line}\n`;
    }
    content += `}\n`;
  }

  writeBruFile(filePath, content);
}

function writeFolderBruFile(folderPath: string, item: BrunoItem): void {
  const fileName = 'folder.bru';
  const filePath = join(folderPath, fileName);

  let content = `meta {\n`;
  content += `  name: ${sanitizeName(item.name)}\n`;
  content += `}\n\n`;

  if (item.name === 'Search') {
    content += `auth {\n`;
    content += `  mode: apikey\n`;
    content += `}\n\n`;
    content += `auth:apikey {\n`;
    content += `  key: Authorization\n`;
    content += `  value: Bearer {{apiKey}}\n`;
    content += `  placement: header\n`;
    content += `}\n`;
  }
  // Note: User folder requests use pre-request scripts for session cookie auth
  // (set in individual request files), not folder-level auth

  writeBruFile(filePath, content);
}

function writeCollectionBruFile(outputDir: string): void {
  let content = `{\n`;
  content += `  "version": "1",\n`;
  content += `  "name": "${COLLECTION_NAME}",\n`;
  content += `  "type": "collection"\n`;
  content += `}\n`;

  writeFileSync(join(outputDir, 'bruno.json'), content, 'utf8');
}

function getRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function normalizeRequestPath(url: string): string {
  const cleanUrl = String(url || '').replace('{{baseUrl}}', '');
  const pathOnly = cleanUrl.split('?')[0] || '/';
  return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
}

function collectExistingRequestRouteKeys(items: BrunoItem[], seen: Set<string>): void {
  for (const item of items) {
    if (item.type === 'folder' && item.items) {
      collectExistingRequestRouteKeys(item.items, seen);
      continue;
    }

    if (item.type !== 'http-request' || !item.request) {
      continue;
    }

    const method = item.request.method;
    const url = item.request.url;
    if (typeof method !== 'string' || typeof url !== 'string') {
      continue;
    }

    seen.add(getRouteKey(method, normalizeRequestPath(url)));
  }
}

function loadBetterAuthRuntimeRoutes(): BetterAuthRuntimeRoute[] {
  const runtimeRoutes: BetterAuthRuntimeRoute[] = [];
  const seen = new Set<string>();
  const authOptions = (auth as { options?: BetterAuthLikeOptions }).options;
  const disabledPaths = new Set(authOptions?.disabledPaths ?? []);
  const isEmailPasswordDisabled = authOptions?.emailAndPassword?.enabled === false;

  for (const [operationId, endpoint] of Object.entries(auth.api as Record<string, any>)) {
    const path = endpoint?.path;
    const method = endpoint?.options?.method;

    if (typeof path !== 'string' || typeof method !== 'string') {
      continue;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (disabledPaths.has(normalizedPath)) {
      continue;
    }

    if (isEmailPasswordDisabled && EMAIL_PASSWORD_ENDPOINT_PATHS.has(normalizedPath)) {
      continue;
    }

    const fullPath = path.startsWith('/') ? `/api/auth${path}` : `/api/auth/${path}`;
    const upperMethod = method.toUpperCase();
    const key = getRouteKey(upperMethod, fullPath);
    if (seen.has(key)) {
      continue;
    }

    const summary =
      endpoint?.options?.metadata?.openapi?.description ||
      endpoint?.options?.metadata?.openapi?.operationId ||
      operationId ||
      `${upperMethod} ${fullPath}`;

    runtimeRoutes.push({
      method: upperMethod,
      path: fullPath,
      summary,
      cookieAuth: !PUBLIC_BETTER_AUTH_ENDPOINT_PATHS.has(normalizedPath),
    });

    seen.add(key);
  }

  return runtimeRoutes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function appendBetterAuthRuntimeItems(brunoCollection: { items?: BrunoItem[] }): number {
  if (!Array.isArray(brunoCollection.items)) {
    brunoCollection.items = [];
  }

  const existingRouteKeys = new Set<string>();
  collectExistingRequestRouteKeys(brunoCollection.items, existingRouteKeys);

  const runtimeRoutes = loadBetterAuthRuntimeRoutes().filter(
    (route) => !existingRouteKeys.has(getRouteKey(route.method, route.path)),
  );

  if (runtimeRoutes.length === 0) {
    return 0;
  }

  const runtimeItems: BrunoItem[] = runtimeRoutes.map((route) => {
    const request: any = {
      method: route.method,
      url: `{{baseUrl}}${route.path}`,
    };

    if (route.cookieAuth) {
      request._isCookieAuth = true;
    } else {
      request.auth = { mode: 'inherit' };
    }

    return {
      name: route.summary,
      type: 'http-request',
      request,
    };
  });

  brunoCollection.items.push({
    name: 'Auth (runtime)',
    type: 'folder',
    items: runtimeItems,
  });

  return runtimeItems.length;
}

function detectCookieAuth(openApiSpec: OpenAPISpec, request: any): void {
  const cleanUrl = request.url.replace('{{baseUrl}}', '');

  for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
    if (path === cleanUrl) {
      const operation = (pathItem as any)[request.method.toLowerCase()];
      if (operation?.security) {
        for (const securityItem of operation.security) {
          for (const [schemeName] of Object.entries(securityItem)) {
            const scheme = openApiSpec.components?.securitySchemes?.[schemeName];
            if (scheme?.in === 'cookie') {
              // Flag as cookie auth - will use pre-request script instead of auth:apikey
              request._isCookieAuth = true;
              return;
            }
          }
        }
      }
    }
  }
}

function processItems(
  items: BrunoItem[],
  baseFolder: string,
  openApiSpec: OpenAPISpec,
  seqCounter = { value: 1 },
): void {
  for (const item of items) {
    if (item.type === 'folder') {
      const folderPath = join(baseFolder, sanitizeName(item.name));
      writeFolderBruFile(folderPath, item);

      if (item.items) {
        processItems(item.items, folderPath, openApiSpec, seqCounter);
      }
    } else if (item.type === 'http-request') {
      const request = { ...item.request };

      // Always use spec example body (which includes defaults and examples from schema)
      const specExampleBody = extractRequestBodyFromSpec(openApiSpec, request.url, request.method);
      if (specExampleBody) {
        request.body = {
          ...request.body,
          mode: 'json',
          json: specExampleBody,
        };
      }

      const queryParams = extractQueryParamsFromSpec(openApiSpec, request.url, request.method);
      if (queryParams) {
        request.params = queryParams;
      }

      const headerParams = extractHeaderParamsFromSpec(openApiSpec, request.url, request.method);
      if (headerParams) {
        request.headers = headerParams;
      }

      detectCookieAuth(openApiSpec, request);

      writeRequestBruFile(baseFolder, { ...item, request }, seqCounter.value++);
    }
  }
}

function resolveRef(openApiSpec: OpenAPISpec, ref: string): any {
  if (!ref.startsWith('#/')) return null;

  const parts = ref.substring(2).split('/');
  let current: any = openApiSpec;

  for (const part of parts) {
    current = current?.[part];
    if (!current) return null;
  }

  return current;
}

function buildExampleFromSchema(schema: any): any {
  // If there's a direct example, use it
  if (schema.example !== undefined) {
    return schema.example;
  }

  // If there's a default, use it
  if (schema.default !== undefined) {
    return schema.default;
  }

  // Handle arrays
  if (schema.type === 'array') {
    if (schema.items) {
      const itemExample = buildExampleFromSchema(schema.items);
      // Only return array with example if we have a meaningful example
      return itemExample !== '' ? [itemExample] : [];
    }
    return [];
  }

  // Handle objects
  if (schema.type === 'object' && schema.properties) {
    const exampleObj: any = {};
    for (const [propName, propSchema] of Object.entries(schema.properties as any)) {
      exampleObj[propName] = buildExampleFromSchema(propSchema);
    }
    return exampleObj;
  }

  // Fallback based on type
  if (schema.type === 'string') return '';
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;

  return '';
}

function extractRequestBodyFromSpec(openApiSpec: OpenAPISpec, url: string, method: string): any {
  const cleanUrl = url.replace('{{baseUrl}}', '');

  for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
    if (path === cleanUrl) {
      const operation = (pathItem as any)[method.toLowerCase()];
      if (operation?.requestBody) {
        const content = operation.requestBody.content?.['application/json'];

        // Resolve schema from $ref or use inline
        let schema = content?.schema;
        if (schema?.$ref) {
          schema = resolveRef(openApiSpec, schema.$ref);
        }

        // Build complete example from schema properties first
        let exampleBody: any = {};
        if (schema?.properties) {
          for (const [propName, propSchema] of Object.entries(schema.properties as any)) {
            exampleBody[propName] = buildExampleFromSchema(propSchema);
          }
        }

        // Then merge inline example on top (if exists) to preserve any curated examples
        if (content?.example) {
          exampleBody = { ...exampleBody, ...content.example };
        }

        return Object.keys(exampleBody).length > 0 ? exampleBody : null;
      }
    }
  }
  return null;
}

function extractHeaderParamsFromSpec(
  openApiSpec: OpenAPISpec,
  url: string,
  method: string,
): Array<{ name: string; value: string }> | null {
  const cleanUrl = url.replace('{{baseUrl}}', '');

  for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
    if (path === cleanUrl) {
      const operation = (pathItem as any)[method.toLowerCase()];
      if (operation?.parameters) {
        const headerParams: Array<{ name: string; value: string }> = [];
        for (const param of operation.parameters) {
          if (param.in === 'header') {
            const schema = param.schema || {};
            const value = param.example || schema.example || schema.default || '';
            // Use {{frontendUrl}} for Referer header specifically
            const finalValue = param.name === 'Referer' ? '{{frontendUrl}}' : (value as string);
            headerParams.push({ name: param.name, value: finalValue });
          }
        }
        return headerParams.length > 0 ? headerParams : null;
      }
    }
  }
  return null;
}

function extractQueryParamsFromSpec(
  openApiSpec: OpenAPISpec,
  url: string,
  method: string,
): Array<{ name: string; value?: string }> | null {
  const cleanUrl = url.replace('{{baseUrl}}', '');

  for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
    if (path === cleanUrl) {
      const operation = (pathItem as any)[method.toLowerCase()];
      if (operation?.parameters) {
        const queryParams: Array<{ name: string; value?: string }> = [];
        for (const param of operation.parameters) {
          if (param.in === 'query') {
            const schema = param.schema || {};
            const value = param.example || schema.example || schema.default || '';
            queryParams.push({ name: param.name, value: value as string });
          }
        }
        return queryParams;
      }
    }
  }
  return null;
}

async function generateBrunoCollection() {
  console.log(`Reading OpenAPI spec from ${OPENAPI_FILE}...`);
  const openApiSpec = parseYamlFile(OPENAPI_FILE);

  console.log('Converting to Bruno format...');
  const brunoCollection = await openApiToBruno(openApiSpec);

  const runtimeAddedCount = appendBetterAuthRuntimeItems(brunoCollection);
  if (runtimeAddedCount > 0) {
    console.log(`Added ${runtimeAddedCount} Better Auth runtime endpoints`);
  }

  mkdirSync(BRUNO_DIR, { recursive: true });

  if (existsSync(GENERATED_DIR)) {
    console.log(`Cleaning existing generated API folder: ${GENERATED_DIR}`);
    rmSync(GENERATED_DIR, { recursive: true });
  }

  mkdirSync(GENERATED_DIR, { recursive: true });

  writeCollectionBruFile(BRUNO_DIR);

  if (brunoCollection.items) {
    processItems(brunoCollection.items, GENERATED_DIR, openApiSpec);
  }

  console.log(`\n✅ Bruno collection updated at: ${BRUNO_DIR}`);
  console.log(`   Generated API requests in: ${GENERATED_SUBFOLDER}/`);
  console.log(`\nYou can now open this folder in Bruno!`);
}

generateBrunoCollection().catch(console.error);
