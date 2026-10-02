import { execFile } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../../scripts/warm-sitemaps.mjs', import.meta.url));

async function run(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  try {
    return await exec(process.execPath, [script], {
      env: { ...process.env, SITEMAP_WARM_BASE_URL: `http://127.0.0.1:${address.port}` },
      timeout: 10_000,
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('production sitemap warmup', () => {
  it('warms the public Host cache key for every locale and marks traffic as a monitor', async () => {
    const requests: { path: string; host?: string; forwarded?: string; proto?: string; agent?: string }[] = [];
    await run((req, res) => {
      requests.push({
        path: req.url!,
        host: req.headers.host,
        forwarded: req.headers['x-forwarded-host'] as string,
        proto: req.headers['x-forwarded-proto'] as string,
        agent: req.headers['user-agent'],
      });
      res.end('<urlset/>');
    });
    expect(requests).toHaveLength(12);
    for (const locale of ['en', 'es', 'zh', 'zh-hant', 'id', 'pt-BR']) {
      expect(requests.filter((request) => request.path === `/__sitemap__/${locale}.xml`)).toHaveLength(2);
    }
    for (const request of requests) {
      expect(request).toMatchObject({
        host: 'nadeshiko.co',
        forwarded: 'nadeshiko.co',
        proto: 'https',
        agent: 'nadeshiko-monitor/sitemap-warmup',
      });
    }
  });

  it('fails the release warmup on a server error', async () => {
    await expect(
      run((_req, res) => {
        res.writeHead(503);
        res.end();
      }),
    ).rejects.toThrow('HTTP 503');
  });

  it('fails instead of treating a truncated response as warmed', async () => {
    await expect(
      run((_req, res) => {
        res.writeHead(200, { 'content-length': '100' });
        res.write('partial');
        setImmediate(() => res.destroy());
      }),
    ).rejects.toThrow('response aborted');
  });
});
