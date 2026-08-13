import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { defineNuxtModule } from '@nuxt/kit';

/**
 * Recomputes nuxt-security's Subresource Integrity digests after every build
 * step that rewrites a built asset has finished.
 *
 * THE PROBLEM. nuxt-security hashes the built assets in a `nitro:build:before`
 * hook and closes over the result, publishing it through a `#sri-hashes` virtual
 * module. Anything that rewrites a file later leaves every digest describing the
 * file as it was earlier, and the browser then refuses to execute it -- SRI is
 * byte-exact and has no partial pass.
 *
 * `@posthog/nuxt` does exactly that: uploading source maps requires
 * `posthog-cli sourcemap inject`, which stamps a chunk id into every JS file in
 * `.output/public`, and it runs at `nitro:build:public-assets` -- AFTER the
 * hashing. On 2026-08-13 that shipped a production build where 37 of 41 scripts
 * were blocked and the site never hydrated.
 *
 * WHY THIS WORKS. The virtual module is a FUNCTION, not a string: nuxt-security
 * registers `() => "export default " + JSON.stringify(sriHashes)`, and Rollup
 * only calls it while building the server bundle -- which happens after public
 * assets are copied and mutated. Replacing that function with one that hashes
 * the directory when asked therefore reads the final bytes, whoever wrote them
 * last, without patching a built artifact or depending on module load order.
 *
 * The digests are computed the same way nuxt-security computes them, because
 * they have to agree exactly: SHA-384, one non-recursive pass per registered
 * `publicAssets` entry (each nested directory is its own entry), keyed by public
 * URL. Kept deliberately close to the original -- see `hashBundledAssets` in
 * nuxt-security -- so that a change there is easy to mirror here.
 *
 * `scripts/verify-sri.mjs` is what proves this is working: it fails the image
 * build if any asset stops matching its digest, so if this module ever stops
 * doing its job the build breaks rather than the site.
 */
export default defineNuxtModule({
  meta: { name: 'sri-after-asset-mutations' },

  setup(_options, nuxt) {
    nuxt.hook('nitro:init', (nitro) => {
      // Absent when `nuxt-security`'s SRI is off, in which case there is nothing
      // to keep honest and this module should do nothing at all.
      if (!nitro.options.virtual?.['#sri-hashes']) return;

      nitro.options.virtual['#sri-hashes'] = async () => {
        const { cdnURL: appCdnUrl = '', baseURL: appBaseUrl } = nitro.options.runtimeConfig.app;
        const hashes: Record<string, string> = {};

        // The FINAL output directory, not `publicAsset.dir`. That field points at
        // the source Nuxt built from (`.nuxt/dist/client`), and the mutation this
        // module exists to account for happens to the COPY in `.output/public`.
        // Hashing the source reproduces nuxt-security's digests exactly -- which
        // is precisely the bug, not the fix.
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
