#!/usr/bin/env bun

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT_DIR = process.cwd();
const OPENAPI_DIR = join(ROOT_DIR, 'docs', 'openapi');
const REDOCLY_CONFIG = join(ROOT_DIR, 'redocly.yaml');
const PACKAGE_JSON = join(ROOT_DIR, 'package.json');
const REDOC_TEMPLATE = join(ROOT_DIR, 'docs', 'redoc-template.hbs');
const ARTIFACTS_DIR = resolve(ROOT_DIR, process.env.DOCS_ARTIFACTS_DIR || '../frontend/public/docs/api');
const BUILD_COMMAND = process.env.DOCS_BUILD_COMMAND || 'docs:build';
const REDOC_THEME_CONFIG = join(ROOT_DIR, 'docs', 'redoc-theme.openapi.json');
const LIVE_RELOAD_PATH = '/__docs_reload';
const PORT = Number(process.env.DOCS_PORT || 4010);
const PORT_ATTEMPTS = Number(process.env.DOCS_PORT_ATTEMPTS || 20);
const POLL_INTERVAL_MS = 1000;
const REBUILD_DEBOUNCE_MS = 250;

const clients = new Set<ReadableStreamDefaultController<string>>();
let lastFingerprint = '';
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
let building = false;
let queued = false;

function listYamlFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      listYamlFiles(fullPath, acc);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = extname(entry.name).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
      acc.push(fullPath);
    }
  }

  return acc;
}

function computeFingerprint(): string {
  const files = listYamlFiles(OPENAPI_DIR).sort();
  if (existsSync(REDOCLY_CONFIG)) {
    files.push(REDOCLY_CONFIG);
  }
  if (existsSync(PACKAGE_JSON)) {
    files.push(PACKAGE_JSON);
  }
  if (existsSync(REDOC_TEMPLATE)) {
    files.push(REDOC_TEMPLATE);
  }
  if (existsSync(REDOC_THEME_CONFIG)) {
    files.push(REDOC_THEME_CONFIG);
  }

  return files
    .map((filePath) => {
      const stat = statSync(filePath);
      return `${filePath}:${stat.mtimeMs}:${stat.size}`;
    })
    .join('|');
}

function notifyReload(): void {
  for (const controller of clients) {
    try {
      controller.enqueue('data: reload\\n\\n');
    } catch {
      clients.delete(controller);
    }
  }
}

async function buildDocs(): Promise<void> {
  if (building) {
    queued = true;
    return;
  }

  building = true;
  console.log(`[docs:serve] Building docs with "${BUILD_COMMAND}"...`);

  const proc = Bun.spawn(['bun', 'run', BUILD_COMMAND], {
    cwd: ROOT_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    if (stdout.trim()) process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
    console.error(`[docs:serve] Build failed (exit ${exitCode}).`);
  } else {
    console.log('[docs:serve] Build complete.');
    notifyReload();
  }

  building = false;

  if (queued) {
    queued = false;
    await buildDocs();
  }
}

function scheduleBuild(): void {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }

  rebuildTimer = setTimeout(() => {
    void buildDocs();
  }, REBUILD_DEBOUNCE_MS);
}

function injectLiveReload(html: string): string {
  const script = `<script>(function(){const es=new EventSource('${LIVE_RELOAD_PATH}');es.onmessage=function(e){if(e.data==='reload'){location.reload();}};})();</script>`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${script}</body>`);
  }
  return `${html}${script}`;
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.yaml':
    case '.yml':
      return 'application/yaml; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function sseResponse(): Response {
  let controllerRef: ReadableStreamDefaultController<string> | null = null;

  const stream = new ReadableStream<string>({
    start(controller) {
      controllerRef = controller;
      clients.add(controller);
      controller.enqueue(': connected\\n\\n');
    },
    cancel() {
      if (controllerRef) {
        clients.delete(controllerRef);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === LIVE_RELOAD_PATH) {
    return sseResponse();
  }

  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const absolutePath = resolve(ARTIFACTS_DIR, `.${requestPath}`);
  const generatedRoot = resolve(ARTIFACTS_DIR);

  if (!absolutePath.startsWith(generatedRoot)) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!existsSync(absolutePath) || statSync(absolutePath).isDirectory()) {
    return new Response('Not found', { status: 404 });
  }

  if (extname(absolutePath).toLowerCase() === '.html') {
    const html = await readFile(absolutePath, 'utf-8');
    return new Response(injectLiveReload(html), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  return new Response(Bun.file(absolutePath), {
    headers: {
      'Content-Type': contentType(absolutePath),
      'Cache-Control': 'no-cache',
    },
  });
}

function startServerWithPortFallback(initialPort: number): number {
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const candidatePort = initialPort + attempt;
    try {
      Bun.serve({
        port: candidatePort,
        fetch: handleRequest,
      });
      return candidatePort;
    } catch (error: any) {
      if (error?.code === 'EADDRINUSE') {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Failed to bind docs server port. Tried ${PORT_ATTEMPTS} ports starting at ${initialPort}. Set DOCS_PORT to a free port.`,
  );
}

async function main(): Promise<void> {
  lastFingerprint = computeFingerprint();
  await buildDocs();

  const boundPort = startServerWithPortFallback(PORT);

  if (boundPort !== PORT) {
    console.warn(`[docs:serve] Port ${PORT} is in use, serving on ${boundPort} instead.`);
  }

  console.log(`[docs:serve] Serving static docs at http://localhost:${boundPort}`);
  console.log(`[docs:serve] Serving artifacts from ${ARTIFACTS_DIR}`);
  console.log('[docs:serve] Watching OpenAPI source files for changes...');

  setInterval(() => {
    const current = computeFingerprint();
    if (current !== lastFingerprint) {
      lastFingerprint = current;
      scheduleBuild();
    }
  }, POLL_INTERVAL_MS);
}

await main();
