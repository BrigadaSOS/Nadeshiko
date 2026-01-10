// List all API routes from OpenAPI spec
// Usage: bun run bin/routes.ts

import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';

interface OpenAPIOperation {
  tags?: string[];
  summary?: string;
  operationId?: string;
}

interface OpenAPISpec {
  paths: Record<string, Record<string, OpenAPIOperation>>;
}

function loadSpec(path: string): OpenAPISpec | null {
  if (!existsSync(path)) return null;
  return parse(readFileSync(path, 'utf8')) as OpenAPISpec;
}

function getRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

const internalSpec = loadSpec('docs/generated/openapi-internal.yaml');
const publicSpec = loadSpec('docs/generated/openapi.yaml');

if (!internalSpec) {
  console.error('OpenAPI spec not found at docs/generated/openapi-internal.yaml');
  console.error('Run "bun run docs:bundle:internal" first to generate it.');
  process.exit(1);
}

// Build set of public routes for comparison
const publicRoutes = new Set<string>();
if (publicSpec) {
  for (const [path, methods] of Object.entries(publicSpec.paths)) {
    for (const method of Object.keys(methods)) {
      if (method === 'parameters') continue;
      publicRoutes.add(getRouteKey(method, path));
    }
  }
}

// Parse all routes from internal spec
const routes: { method: string; path: string; tag: string; summary: string; internal: boolean }[] = [];

for (const [path, methods] of Object.entries(internalSpec.paths)) {
  for (const [method, details] of Object.entries(methods)) {
    if (method === 'parameters') continue;

    const key = getRouteKey(method, path);
    routes.push({
      method: method.toUpperCase(),
      path,
      tag: details.tags?.[0] || 'Other',
      summary: details.summary || details.operationId || '',
      internal: !publicRoutes.has(key),
    });
  }
}

// Group by tag
const byTag = routes.reduce(
  (acc, route) => {
    if (!acc[route.tag]) acc[route.tag] = [];
    acc[route.tag].push(route);
    return acc;
  },
  {} as Record<string, typeof routes>,
);

// Sort tags alphabetically
const sortedTags = Object.keys(byTag).sort();

for (const tag of sortedTags) {
  const tagRoutes = byTag[tag];
  console.log(`\n${tag}`);
  console.log('─'.repeat(70));

  for (const route of tagRoutes) {
    const method = route.method.padEnd(7);
    const path = route.path.padEnd(35);
    const marker = route.internal ? ' [internal]' : '';
    console.log(`  ${method} ${path} ${route.summary}${marker}`);
  }
}

const internalCount = routes.filter((r) => r.internal).length;
const publicCount = routes.length - internalCount;

console.log(`\n${routes.length} routes total (${publicCount} public, ${internalCount} internal)\n`);
