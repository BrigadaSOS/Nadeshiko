import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const locales = ['en', 'es', 'zh', 'zh-hant', 'id', 'pt-BR'];
const files = ['sitemap.xml', 'sitemap_index.xml', ...locales.map((locale) => `${locale}.xml`)];

export async function readPublished(dir) {
  try {
    const manifest = JSON.parse(await readFile(join(dir, 'current.json'), 'utf8'));
    if (
      manifest.version !== 1 ||
      !/^[a-f0-9-]{36}$/.test(manifest.generation) ||
      !Number.isFinite(Date.parse(manifest.generatedAt))
    )
      throw new Error('Invalid sitemap manifest');
    for (const file of files) {
      const meta = manifest.files?.[file];
      if (!meta || !/^[a-f0-9]{64}$/.test(meta.sha256)) throw new Error('Incomplete sitemap manifest');
      const body = await readFile(join(dir, manifest.generation, file));
      if (body.length !== meta.bytes || createHash('sha256').update(body).digest('hex') !== meta.sha256) {
        throw new Error(`Invalid published sitemap: ${file}`);
      }
    }
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function validateXml(body, locale) {
  const root = locale ? 'urlset' : 'sitemapindex';
  if (
    !body.includes(`<${root}`) ||
    !body.includes(`</${root}>`) ||
    !body.includes('http://www.sitemaps.org/schemas/sitemap/0.9') ||
    /error_messages|errors=true/.test(body)
  )
    throw new Error(`Invalid sitemap XML: ${locale || 'index'}`);
  const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (!locations.length || new Set(locations).size !== locations.length)
    throw new Error('Empty or duplicate sitemap URLs');
  if (locale) {
    if (
      locations.some(
        (loc) => !loc.startsWith(`https://nadeshiko.co/${locale}/`) && loc !== `https://nadeshiko.co/${locale}`,
      )
    ) {
      throw new Error(`Unexpected sitemap URL for ${locale}`);
    }
  } else if (
    locations.length !== locales.length ||
    locales.some((l) => !locations.includes(`https://nadeshiko.co/__sitemap__/${l}.xml`))
  ) {
    throw new Error('Incomplete sitemap index');
  }
}

// All readers see either the previous complete set or the next complete set.
// No expiry: refresh is an explicit operator action, independent of app releases.
export async function publishSnapshot(dir, generate, { refresh = false } = {}) {
  await mkdir(dir, { recursive: true });
  if (!refresh && (await readPublished(dir))) return { reused: true };
  const lock = join(dir, 'generation.lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'Sitemap generation already locked; check the generation process before removing generation.lock',
      );
    throw error;
  }
  const generation = randomUUID();
  const target = join(dir, generation);
  const pointer = join(dir, `current-${generation}.tmp`);
  let published = false;
  try {
    if (!refresh && (await readPublished(dir))) return { reused: true };
    await mkdir(target);
    const output = await generate();
    const manifest = { version: 1, generation, generatedAt: new Date().toISOString(), files: {} };
    for (const file of files) {
      const body = output[file];
      if (typeof body !== 'string') throw new Error(`Missing sitemap: ${file}`);
      validateXml(body, file === 'sitemap.xml' || file === 'sitemap_index.xml' ? undefined : file.slice(0, -4));
      await writeFile(join(target, file), body);
      manifest.files[file] = {
        bytes: Buffer.byteLength(body),
        sha256: createHash('sha256').update(body).digest('hex'),
      };
    }
    await writeFile(pointer, JSON.stringify(manifest));
    await rename(pointer, join(dir, 'current.json'));
    published = true;
    return { reused: false, manifest };
  } finally {
    if (!published) await rm(target, { recursive: true, force: true });
    await rm(pointer, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

function get(port, path) {
  return new Promise((resolveBody, reject) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path,
        agent: false,
        headers: {
          host: 'nadeshiko.co',
          'x-forwarded-host': 'nadeshiko.co',
          'x-forwarded-proto': 'https',
          'user-agent': 'nadeshiko-monitor/sitemap-snapshot',
        },
        signal: AbortSignal.timeout(120_000),
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 16 * 1024 * 1024) request.destroy(new Error('Sitemap exceeds 16 MiB'));
        });
        response.on('error', reject);
        response.on('aborted', () => reject(new Error('Sitemap response aborted')));
        response.on('end', () =>
          response.statusCode === 200 ? resolveBody(body) : reject(new Error(`${path}: HTTP ${response.statusCode}`)),
        );
      },
    );
    request.on('error', reject);
  });
}

export async function generateIsolated({ entry = '.output/server/index.mjs' } = {}) {
  const reserve = http.createServer();
  await new Promise((r) => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1',
      NITRO_CLUSTER_WORKERS: '1',
      NADESHIKO_SITEMAP_GENERATOR: '1',
      OTEL_SDK_DISABLED: 'true',
      NUXT_ASSET_ARCHIVE_DIR: '',
      NODE_OPTIONS: '--max-old-space-size=384',
    },
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  const exited = new Promise((r) => child.once('exit', r));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error('Isolated sitemap server exited before readiness');
      try {
        await get(port, '/up');
        ready = true;
        break;
      } catch {
        /* wait for listener */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) throw new Error('Isolated sitemap server did not become ready');
    const output = {};
    for (const locale of locales) {
      const body = await get(port, `/__sitemap__/${locale}.xml`);
      validateXml(body, locale);
      output[`${locale}.xml`] = body;
    }
    const index = await get(port, '/sitemap_index.xml');
    output['sitemap.xml'] = index;
    output['sitemap_index.xml'] = index;
    return output;
  } finally {
    if (child.pid && child.exitCode === null) {
      process.kill(-child.pid, 'SIGTERM');
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 5000);
      await exited;
      clearTimeout(timer);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.env.NUXT_SITEMAP_SNAPSHOT_DIR;
  if (!dir) throw new Error('NUXT_SITEMAP_SNAPSHOT_DIR must identify the persistent snapshot mount');
  const result = await publishSnapshot(resolve(dir), generateIsolated, { refresh: process.argv.includes('--refresh') });
  console.log(
    result.reused
      ? 'Reusing published sitemaps; no generation needed'
      : `Published sitemaps ${result.manifest.generation}`,
  );
}
