const locales = ['en', 'es', 'zh', 'zh-hant', 'id', 'pt-BR'];
const baseUrl = process.env.SITEMAP_WARM_BASE_URL ?? 'http://127.0.0.1:3000';

for (let pass = 0; pass < 2; pass += 1) {
  for (const locale of locales) {
    // Nitro's response cache includes the request host. Warming localhost
    // without these headers creates a different cache entry from public
    // traffic and leaves nadeshiko.co cold after Cloudflare's deploy purge.
    const response = await fetch(`${baseUrl}/__sitemap__/${locale}.xml`, {
      headers: { host: 'nadeshiko.co', 'x-forwarded-host': 'nadeshiko.co', 'x-forwarded-proto': 'https' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`${locale}: HTTP ${response.status}`);
    await response.arrayBuffer();
  }
}
