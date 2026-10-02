import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { publishSnapshot, generateIsolated } from './publish-sitemaps.mjs';
const cwd = process.cwd();
const entry = cwd + '/.output/server/index.mjs';
const dir = await fs.mkdtemp('/tmp/nadeshiko-snapshot-fixture-');
let calls = 0,
  slug = 'original-catalogue',
  failCatalogue = false;
const backend = http.createServer((req, res) => {
  calls++;
  res.setHeader('Content-Type', 'application/json');
  if (failCatalogue && req.url.includes('/episodes')) {
    res.statusCode = 503;
    res.end(JSON.stringify({ message: 'fixture outage' }));
    return;
  }
  const pagination = { hasMore: false, cursor: null };
  res.end(
    JSON.stringify(
      req.url.startsWith('/v1/media?')
        ? { media: [{ publicId: 'fixture', slug, episodeCount: 1 }], pagination, stats: { totalMedia: 1 } }
        : { episodes: [], segments: [], pagination },
    ),
  );
});
await new Promise((r) => backend.listen(0, '127.0.0.1', r));
Object.assign(process.env, {
  NUXT_BACKEND_INTERNAL_URL: `http://127.0.0.1:${backend.address().port}`,
  NUXT_BACKEND_HOST_HEADER: '',
  NUXT_NADESHIKO_API_KEY: 'fixture-only',
  NUXT_INTERNAL_PROXY_SECRET: 'fixture-only',
  NUXT_SHIRABE_API_KEY: '',
  NUXT_ASSET_ARCHIVE_DIR: '',
  NUXT_SITEMAP_SNAPSHOT_DIR: dir,
  OTEL_SDK_DISABLED: 'true',
  LOG_LEVEL: 'error',
});
let child;
const reserve = http.createServer();
await new Promise((r) => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
function request(path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        agent: false,
        headers: { host: 'nadeshiko.co', 'x-forwarded-proto': 'https', ...headers },
      },
      (res) => {
        let body = '';
        res.on('data', (s) => (body += s));
        res.on('end', () =>
          res.statusCode === 307 && res.headers.location
            ? resolve(request(new URL(res.headers.location, 'http://localhost').pathname, method, headers))
            : resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    r.on('error', reject);
    r.setTimeout(5000, () => r.destroy(Error('timeout')));
    r.end();
  });
}
async function start() {
  child = spawn(process.execPath, [entry], {
    cwd,
    env: { ...process.env, PORT: String(port), NITRO_HOST: '127.0.0.1', NITRO_CLUSTER_WORKERS: '2' },
    detached: true,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request('/up')).status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('startup failed');
}
async function stop() {
  if (!child) return;
  const done = new Promise((r) => child.once('exit', r));
  process.kill(-child.pid, 'SIGTERM');
  await done;
  child = undefined;
}
try {
  const first = await publishSnapshot(dir, () => generateIsolated({ entry }));
  assert.equal(first.reused, false);
  const generationCalls = calls;
  await publishSnapshot(dir, () => {
    throw Error('must reuse across releases');
  });
  await start();
  const paths = [
    '/sitemap.xml',
    '/sitemap_index.xml',
    ...['en', 'es', 'zh', 'zh-hant', 'id', 'pt-BR'].map((l) => `/__sitemap__/${l}.xml`),
  ];
  for (let round = 0; round < 3; round++)
    for (const path of paths) {
      const r = await request(path);
      assert.equal(r.status, 200, path);
      assert.equal(r.headers['x-sitemap-generated'], first.manifest.generatedAt);
      if (path.includes('/__sitemap__/')) assert.match(r.body, /original-catalogue/);
    }
  const r = await request('/__sitemap__/en.xml');
  assert.equal((await request('/__sitemap__/en.xml', 'GET', { 'if-none-match': r.headers.etag })).status, 304);
  const head = await request('/__sitemap__/en.xml', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], r.headers['content-length']);
  assert.equal((await request('/__sitemap__/ja.xml')).status, 404);
  assert.equal((await request('/api/__sitemap__/sentences?locale=en')).status, 404);
  await fs.rename(dir + '/current.json', dir + '/held.json');
  assert.equal((await request('/__sitemap__/en.xml')).status, 503);
  assert.equal(calls, generationCalls);
  await fs.rename(dir + '/held.json', dir + '/current.json');
  await stop();
  await start();
  slug = 'new-catalogue';
  assert.match((await request('/__sitemap__/en.xml')).body, /original-catalogue/);
  assert.equal(calls, generationCalls);
  await publishSnapshot(dir, () => generateIsolated({ entry }), { refresh: true });
  assert.match((await request('/__sitemap__/en.xml')).body, /new-catalogue/);
  assert.equal(calls, generationCalls * 2);
  failCatalogue = true;
  await assert.rejects(
    publishSnapshot(dir, () => generateIsolated({ entry }), { refresh: true }),
    /Invalid sitemap XML/,
  );
  assert.match((await request('/__sitemap__/en.xml')).body, /new-catalogue/);
  console.log(
    JSON.stringify({
      generationCalls,
      requestsWithoutBackendCalls: 24,
      conditional304: true,
      head: true,
      missingSnapshot503WithoutGeneration: true,
      restartReused: true,
      explicitRefresh: true,
      failedRefreshKeepsPublishedFiles: true,
      result: 'pass',
    }),
  );
} finally {
  await stop();
  await new Promise((r) => backend.close(r));
  await fs.rm(dir, { recursive: true, force: true });
}
