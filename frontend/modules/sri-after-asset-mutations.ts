import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { defineNuxtModule } from '@nuxt/kit';

// Recompute SRI after asset mutations. nuxt-security hashes at nitro:build:before, but PostHog source-map
// injection rewrites JS at nitro:build:public-assets. Its virtual module is evaluated later by Rollup, so
// replacing the function lets us hash final output without depending on hook order.
// Mirror nuxt-security: SHA-384, non-recursive per publicAssets entry, keyed by URL.
// scripts/verify-sri.mjs checks the real build output and fails the image on a mismatch.
export default defineNuxtModule({
  meta: { name: 'sri-after-asset-mutations' },

  setup(_options, nuxt) {
    nuxt.hook('nitro:init', (nitro) => {
      if (!nitro.options.virtual?.['#sri-hashes']) return;

      nitro.options.virtual['#sri-hashes'] = async () => {
        const { cdnURL: appCdnUrl = '', baseURL: appBaseUrl } = nitro.options.runtimeConfig.app;
        const hashes: Record<string, string> = {};

        // Hash the final .output/public copy, not publicAsset.dir: PostHog mutates output after the source was hashed.
        const publicDir = nitro.options.output.publicDir;

        for (const { baseURL = '' } of nitro.options.publicAssets) {
          const dir = join(publicDir, baseURL);
          if (!existsSync(dir)) continue;

          const entries = await readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            if (!entry.isFile()) continue;

            const content = await readFile(join(dir, entry.name));
            const digest = `sha384-${createHash('sha384').update(content).digest('base64')}`;
            const fullPath = join(baseURL, entry.name);

            if (appCdnUrl) {
              const relative = isAbsolute(fullPath) ? fullPath.slice(1) : fullPath;
              const base = appCdnUrl.endsWith('/') ? appCdnUrl : `${appCdnUrl}/`;
              hashes[new URL(relative, base).href] = digest;
            } else {
              hashes[join('/', appBaseUrl, fullPath)] = digest;
            }
          }
        }

        return `export default ${JSON.stringify(hashes)}`;
      };
    });
  },
});
