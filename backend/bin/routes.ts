// List API routes from OpenAPI spec + runtime Better Auth routes
// Usage: bun run bin/routes.ts

import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { auth } from '@lib/auth';

interface OpenAPIOperation {
  tags?: string[];
  summary?: string;
  operationId?: string;
  description?: string;
}

interface OpenAPISpec {
  paths: Record<string, Record<string, OpenAPIOperation>>;
}

interface RouteInfo {
  method: string;
  path: string;
  tag: string;
  summary: string;
  internal: boolean;
  source: 'openapi' | 'runtime';
}

interface BetterAuthLikeOptions {
  disabledPaths?: string[];
  emailAndPassword?: {
    enabled?: boolean;
  };
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

function loadSpec(path: string): OpenAPISpec | null {
  if (!existsSync(path)) return null;
  return parse(readFileSync(path, 'utf8')) as OpenAPISpec;
}

function getRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function loadBetterAuthRuntimeRoutes(): RouteInfo[] {
  const runtimeRoutes: RouteInfo[] = [];
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
    const key = getRouteKey(method, fullPath);
    if (seen.has(key)) {
      continue;
    }

    const summary =
      endpoint?.options?.metadata?.openapi?.description ||
      endpoint?.options?.metadata?.openapi?.operationId ||
      operationId;

    runtimeRoutes.push({
      method: method.toUpperCase(),
      path: fullPath,
      tag: 'Auth (runtime)',
      summary,
      internal: true,
      source: 'runtime',
    });

    seen.add(key);
  }

  return runtimeRoutes;
}

function loadManualRuntimeRoutes(): RouteInfo[] {
  return [
    {
      method: 'GET',
      path: '/v1/user/quota',
      tag: 'User (runtime)',
      summary: 'Get current monthly API quota for authenticated user',
      internal: true,
      source: 'runtime',
    },
  ];
}

const internalSpec = loadSpec('docs/generated/openapi-internal.yaml');
const publicSpec = loadSpec('docs/generated/openapi.yaml');

if (!internalSpec) {
  console.error('OpenAPI spec not found at docs/generated/openapi-internal.yaml');
  console.error('Run "bun run docs:bundle:internal" first to generate it.');
  process.exit(1);
}

const publicRoutes = new Set<string>();
if (publicSpec) {
  for (const [path, methods] of Object.entries(publicSpec.paths)) {
    for (const method of Object.keys(methods)) {
      if (method === 'parameters') continue;
      publicRoutes.add(getRouteKey(method, path));
    }
  }
}

const routes: RouteInfo[] = [];

for (const [path, methods] of Object.entries(internalSpec.paths)) {
  for (const [method, details] of Object.entries(methods)) {
    if (method === 'parameters') continue;

    const key = getRouteKey(method, path);
    routes.push({
      method: method.toUpperCase(),
      path,
      tag: details.tags?.[0] || 'Other',
      summary: details.summary || details.operationId || details.description || '',
      internal: !publicRoutes.has(key),
      source: 'openapi',
    });
  }
}

const runtimeRoutes = loadBetterAuthRuntimeRoutes();
const manualRuntimeRoutes = loadManualRuntimeRoutes();
const allRouteKeys = new Set(routes.map((route) => getRouteKey(route.method, route.path)));
for (const runtimeRoute of [...runtimeRoutes, ...manualRuntimeRoutes]) {
  const key = getRouteKey(runtimeRoute.method, runtimeRoute.path);
  if (!allRouteKeys.has(key)) {
    routes.push(runtimeRoute);
  }
}

const byTag = routes.reduce(
  (acc, route) => {
    if (!acc[route.tag]) acc[route.tag] = [];
    acc[route.tag].push(route);
    return acc;
  },
  {} as Record<string, RouteInfo[]>,
);

const sortedTags = Object.keys(byTag).sort();

for (const tag of sortedTags) {
  const tagRoutes = byTag[tag];
  console.log(`\n${tag}`);
  console.log('─'.repeat(70));

  for (const route of tagRoutes) {
    const method = route.method.padEnd(7);
    const path = route.path.padEnd(35);
    const markers: string[] = [];
    if (route.internal) markers.push('internal');
    if (route.source === 'runtime') markers.push('runtime');
    const marker = markers.length > 0 ? ` [${markers.join(', ')}]` : '';
    console.log(`  ${method} ${path} ${route.summary}${marker}`);
  }
}

const internalCount = routes.filter((route) => route.internal).length;
const publicCount = routes.length - internalCount;
const runtimeCount = routes.filter((route) => route.source === 'runtime').length;

console.log(
  `\n${routes.length} routes total (${publicCount} public, ${internalCount} internal, ${runtimeCount} runtime)\n`,
);
