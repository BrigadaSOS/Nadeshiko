// nadeshiko-orphan-chunk-reload
//
// Recovery for the "Failed to fetch dynamically imported module: /_nuxt/<hash>.js"
// error that hits users whose browser holds HTML from a previous Nuxt build.
//
// Mechanism: when a browser cached HTML points at a chunk URL that the
// current build no longer ships, the chunk request hits this Worker, the
// Worker asks origin, gets a 404, and returns a tiny ES module that calls
// window.location.reload(). The browser's dynamic-import() resolves cleanly
// (no error), the reload runs, the user fetches fresh HTML pointing at the
// new build's chunk hashes. Self-healing.
//
// Narrow scope:
//   - Only matches /_nuxt/*.js paths
//   - Only matches nadeshiko.co (other hosts pass through untouched)
//   - Only acts on a 404 from origin; all other statuses pass through
//   - On Worker/network errors, passes through (no reload-thrash)
//
// See infra/orphan-chunk-reload-worker/README.md for the rationale and
// deploy instructions.

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Gate: only act on /_nuxt/*.js paths. Everything else falls through
    // to origin unchanged. This keeps the Worker from doing anything on
    // the vast majority of traffic (HTML, API, assets).
    if (
      url.hostname !== "nadeshiko.co" ||
      !url.pathname.startsWith("/_nuxt/") ||
      !url.pathname.endsWith(".js")
    ) {
      return fetch(request);
    }

    // Ask origin. Don't go through CF cache here — we want to observe the
    // current state of the chunk on the running container. If the chunk
    // exists, it loads fast from the kamal-proxy origin anyway.
    //
    // The "cf" cache hint on fetch init is a CF extension — workers-types
    // doesn't surface it on the standard RequestInit, so cast to
    // RequestInit to satisfy strict TS. wrangler's runtime accepts it.
    let originResponse: Response;
    try {
      const init = { cf: { cacheTtl: 0, cacheEverything: false } } as RequestInit;
      originResponse = await fetch(request, init);
    } catch {
      // Transient network error — pass the original request through so
      // the browser sees a real network failure rather than a synthetic
      // 404/reload. This prevents reload-thrash on kamal-proxy blips.
      return fetch(request);
    }

    if (originResponse.status !== 404) {
      // Happy path: chunk exists, return origin's response as-is.
      return originResponse;
    }

    // Orphan chunk confirmed. Return a valid ES module that triggers a
    // page reload. The browser's dynamic-import() resolves (no error
    // surfaced to the app), then the reload kicks in. Fresh HTML next.
    //
    // The script is wrapped in a `try` so a non-browser context (rare
    // but possible — e.g. fetch() from a test runner) doesn't throw.
    const reloadScript = `
if (typeof window !== "undefined" && window.location && typeof window.location.reload === "function") {
  try { window.location.reload(); } catch (_) {}
}
export default {};
`.trim();

    return new Response(reloadScript, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        // Don't let this synthetic response cache anywhere. If CF caches
        // it, an unrelated 404 could end up serving the reload-trigger
        // to a chunk URL that the new build DOES ship but with a slow
        // cold-cache. Keep the response transient.
        "Cache-Control": "no-store",
      },
    });
  },
};