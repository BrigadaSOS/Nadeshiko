/**
 * Keeps a superseded build's `/_nuxt/*` files servable after the deploy that
 * replaced them.
 *
 * THE PROBLEM THIS SOLVES IS THE WHOLE OF `Failed to fetch dynamically imported
 * module`. A rendered page names the content-hashed chunks of the build that
 * rendered it. The container only ever holds ONE build, so the moment a new one
 * is live every older page in existence -- a tab left open, HTML held at the
 * edge, HTML in a reader's own disk cache -- points at `/_nuxt/*` files that now
 * 404. The reader is mid-visit and there is nothing wrong with their page except
 * that we moved.
 *
 * Everything else in this area is damage control on that one fact: the edge
 * purge (`.kamal/hooks/post-deploy`) shortens how long stale HTML is handed out,
 * and the client-side reload (`app/plugins/chunkReload.client.ts`) tries to get
 * the reader onto the new build. Neither helps a tab that is ALREADY open, and
 * both are races. Serving the old chunk is not a race: the reader's page keeps
 * working because the file it asks for is still there.
 *
 * Content-hashed names are what make this safe and nearly free. `DrC9mS-I2.js`
 * means one exact byte sequence forever, so accumulating builds cannot collide
 * and an archived copy is indistinguishable from the original. Unchanged chunks
 * keep their name across builds, so a deploy adds only what actually changed --
 * single-digit MB against the ~10MB a full build weighs.
 *
 * THAT PREMISE IS CURRENTLY FALSE FOR JS, which is the one thing to know before
 * trusting anything above. `@posthog/nuxt` stamps a per-build UUID into every JS
 * file in `.output/public` (`//# chunkId=...`) AFTER Vite has hashed the
 * filename from the pre-injection content. An unchanged chunk therefore keeps
 * its name and gets DIFFERENT BYTES on every deploy, and this archive ends up
 * holding one of those bodies while the running build serves another under the
 * same URL.
 *
 * The reader-visible failure is then not the 404 everything here was built for.
 * It is an SRI block: a tab holding the old build's HTML has pinned that
 * filename to the old digest, asks for it, receives the new build's bytes and
 * refuses to execute them. v2.4.0 did exactly this on 2026-08-19:
 *
 *     Failed to find a valid digest in the 'integrity' attribute for resource
 *     '/_nuxt/CNs_Ozdc2.js' ... The resource has been blocked.
 *
 * A reload fixes it, because the new HTML pins the new digest. Nothing in this
 * file can: it cannot serve two bodies for one URL, and which digest is demanded
 * belongs to whichever HTML the reader happens to be holding.
 *
 * The fix is to make a filename mean one byte sequence again -- a per-build
 * `app.buildAssetsDir` so two builds never share a URL, or a chunk id derived
 * from the file's own content rather than from the build. Until one lands,
 * `experimental.checkOutdatedBuildInterval` (nuxt.config.ts) shortens how long a
 * tab can sit in the window; it does not close it.
 */

import { resolve, sep } from 'node:path';

/**
 * How long a file that is no longer part of the running build stays servable,
 * when nothing says otherwise.
 *
 * The window that has to be covered is "how stale can a reader's page be", and
 * the honest answer is unbounded -- a tab open over a weekend is ordinary. Thirty
 * days is chosen as the point past which a reload is the reasonable outcome
 * anyway, not as a measurement.
 *
 * OVERRIDABLE PER ENVIRONMENT (`NUXT_ASSET_ARCHIVE_DAYS`) because the two
 * environments are not alike. Production releases 5-12 times a month; staging
 * deploys on every push to main, which was 188 commits in the 30 days to
 * 2026-08-13 -- fifteen times the rate, against nobody who keeps a staging tab
 * open for a fortnight. Same window on both would size the volume for the
 * environment that needs it least.
 *
 * Anchored to mtime, and the startup pass TOUCHES every file the running build
 * still uses (see `03-asset-archive.ts`). Without that touch a chunk that
 * survives unchanged across months of deploys would age out of the archive while
 * still being live, which is the one way this could serve a 404 for a file it
 * has.
 */
export const ASSET_ARCHIVE_RETENTION_DAYS = 30;

export function assetArchiveRetentionMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

/**
 * Whether a file of the running build is worth keeping once it is superseded.
 *
 * SOURCEMAPS ARE NOT, and they are 85% of the bytes: a build here is 12.5MB, of
 * which 10.6MB is `.map` against 1.9MB of the code and styles that readers
 * actually load. Excluding them is not a trade against debuggability, because
 * with `sourcemap: { client: 'hidden' }` (nuxt.config.ts) the emitted chunks
 * carry no `sourceMappingURL` at all -- nothing references these files, so no
 * browser has ever asked for one, and an old page cannot start. The maps that
 * matter are the ones `@posthog/nuxt` uploads at build time, which live in
 * PostHog and are keyed by chunk id rather than fetched from here.
 *
 * So this keeps the archive to what a stale page can genuinely request, and the
 * volume to a seventh of the size.
 */
export function isArchivableAsset(name: string): boolean {
  return !name.endsWith('.map');
}

const ASSET_PREFIX = '/_nuxt/';

/**
 * Strict allowlist, and it is doing security work rather than tidiness.
 *
 * This name is joined onto a directory path, so it is the only thing standing
 * between a request and an arbitrary file read. Nothing outside this set can
 * express a traversal: no `/`, no `%` (so no percent-encoded separator survives
 * to be decoded later), and a leading dot is excluded, which rules out `.` and
 * `..` by construction rather than by special case.
 *
 * THE FIRST CHARACTER ADMITS `_`, which is not cosmetic: Vite names the chunk
 * for a dynamic route segment after the segment itself, so a build emits
 * `_id_.CylgXoQM.css` and `_...CfAQ-uCX.css`. A leading-letter-only rule reads
 * those as inadmissible and 404s the styles of every `[id]` page on the older
 * build -- the precise failure this module exists to prevent, reintroduced by
 * the module preventing it.
 */
const ASSET_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * A build's own directory segment, which `app.buildAssetsDir` sets to the build
 * id (a UUID). Matched strictly rather than loosely, because this pattern is
 * doing two jobs at once: it routes a request to the right build, AND it is what
 * keeps `builds/**` out -- `builds` is not a UUID, so the app manifest cannot
 * express itself as a build segment however the rest of the path is arranged.
 */
const BUILD_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isBuildSegment(segment: string): boolean {
  return BUILD_SEGMENT.test(segment);
}

/**
 * The archived file a request is asking for, as a `<build>/<name>` key, or
 * `null` if this request is not one this archive may answer.
 *
 * EXACTLY TWO SEGMENTS, the first a build id and the second an asset name. That
 * is what keeps the app manifest out: it lives at
 * `/_nuxt/<build>/builds/latest.json` and `/_nuxt/<build>/builds/meta/*.json`,
 * which is three segments and whose middle one is not a UUID either. It is
 * Nuxt's own record of which build is current, served with `maxAge: 1` precisely
 * so it is never stale, and serving a superseded copy of the file whose job is
 * to say "the build changed" would be the one genuinely harmful thing this
 * module could do.
 *
 * The key keeps its slash all the way to `archivedAssetPath`, which resolves it
 * and re-checks containment -- neither segment can express a traversal, and the
 * resolution is checked anyway.
 */
export function archivableAssetName(pathname: string): string | null {
  if (!pathname.startsWith(ASSET_PREFIX)) return null;

  const rest = pathname.slice(ASSET_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;

  const build = rest.slice(0, slash);
  const name = rest.slice(slash + 1);

  if (!BUILD_SEGMENT.test(build)) return null;
  if (!name || name.includes('/')) return null;
  if (!ASSET_NAME.test(name)) return null;

  return `${build}/${name}`;
}

/**
 * Resolves a validated name inside the archive directory.
 *
 * Belt and braces: `ASSET_NAME` already makes a traversal unexpressible, and
 * this re-checks containment after resolution anyway. The cost is one string
 * compare on a path that is about to be opened, and the failure it guards
 * against is reading any file the process can see.
 */
export function archivedAssetPath(dir: string, name: string): string | null {
  const root = resolve(dir);
  const file = resolve(root, name);

  return file.startsWith(root + sep) ? file : null;
}

/**
 * Whether an archived file has aged out, given the build that is running now.
 *
 * Membership of the live build wins over age unconditionally -- see the note on
 * `ASSET_ARCHIVE_RETENTION_MS` for why a live chunk can look old.
 */
export function assetHasExpired(
  name: string,
  mtimeMs: number,
  liveAssets: ReadonlySet<string>,
  now: number,
  retentionMs: number,
): boolean {
  if (liveAssets.has(name)) return false;

  return now - mtimeMs >= retentionMs;
}

/**
 * Content types for what actually lands in `_nuxt/`: the chunks, their styles,
 * their sourcemaps, and whatever fonts and images Vite fingerprinted.
 *
 * Nitro's static handler derives these from a full mime database; reproducing
 * that here would be a lot of dependency for a directory whose contents we
 * generate ourselves. Anything unlisted falls back to a download rather than
 * being guessed at.
 */
const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
};

export function assetContentType(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();

  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * The pathname out of a raw request path, without building a `URL` to get it.
 *
 * Worth the four lines: the handler this feeds sits at the head of the request
 * stack and runs for every request the server takes, the overwhelming majority
 * of which are not assets at all. Parsing a URL per request to answer "does this
 * start with /_nuxt/" is a cost with nothing behind it.
 */
export function assetPathname(path: string): string {
  const query = path.indexOf('?');

  return query === -1 ? path : path.slice(0, query);
}
