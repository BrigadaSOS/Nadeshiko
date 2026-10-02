import http from 'node:http';
import https from 'node:https';

const locales = ['en', 'es', 'zh', 'zh-hant', 'id', 'pt-BR'];
const baseUrl = process.env.SITEMAP_WARM_BASE_URL ?? 'http://127.0.0.1:3000';

function warmSitemap(locale) {
  const url = new URL(`/__sitemap__/${locale}.xml`, baseUrl);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    // Node fetch can replace Host with the URL's hostname. Sitemap keys prefer
    // Host over X-Forwarded-Host, so use the HTTP client to warm the public key.
    const request = client.get(url, {
      headers: {
        host: 'nadeshiko.co',
        'x-forwarded-host': 'nadeshiko.co',
        'x-forwarded-proto': 'https',
        'user-agent': 'nadeshiko-monitor/sitemap-warmup',
      },
      signal: AbortSignal.timeout(120_000),
    }, (response) => {
      response.on('error', reject);
      response.on('aborted', () => reject(new Error(`${locale}: response aborted`)));
      response.resume();
      response.on('end', () => {
        if (response.statusCode !== 200) reject(new Error(`${locale}: HTTP ${response.statusCode}`));
        else resolve();
      });
    });
    request.on('error', reject);
  });
}

for (let pass = 0; pass < 2; pass += 1) {
  for (const locale of locales) {
    // Nitro's response cache includes the request host. Warming localhost
    // without these headers creates a different cache entry from public
    // traffic and leaves nadeshiko.co cold after Cloudflare's deploy purge.
    await warmSitemap(locale);
  }
}
