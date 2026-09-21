const locales = ['en', 'es', 'zh', 'zh-hant', 'id', 'pt-BR'];
const baseUrl = process.env.SITEMAP_WARM_BASE_URL ?? 'http://127.0.0.1:3000';

for (let pass = 0; pass < 2; pass += 1) {
  for (const locale of locales) {
    const response = await fetch(`${baseUrl}/__sitemap__/${locale}.xml`);
    if (!response.ok) throw new Error(`${locale}: HTTP ${response.status}`);
    await response.arrayBuffer();
  }
}
