import { metrics } from '@opentelemetry/api';
import { getCookie } from 'h3';
import { PostHog } from 'posthog-node';
import { resolveEventTraffic, trafficAttributes } from '#shared/utils/traffic';
import { normalizeRoute } from '~~/route-normalization.mjs';
import { createLogger } from '../utils/logger';

const logger = createLogger('nitro:http');

const errorCounter = metrics.getMeter('nadeshiko-frontend').createCounter('app.exception', {
  description: 'Total application exceptions by fingerprint',
});

const SKIP_PATTERNS = [/node_modules\//, /node:internal\//, /<anonymous>/];
const FRAME_RE = /at .+?\((.+?):\d+:\d+\)|at (.+?):\d+:\d+/;

function computeFingerprint(error: Error | string, errorType: string): { fingerprint: string; group: string } {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  let frame = 'unknown';
  if (stack) {
    for (const line of stack.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('at ')) continue;
      if (SKIP_PATTERNS.some((p) => p.test(trimmed))) continue;
      const match = trimmed.match(FRAME_RE);
      const filePath = match?.[1] || match?.[2];
      if (filePath) {
        frame = filePath.replace(/:\d+:\d+$/, '');
        break;
      }
    }
  }

  return {
    fingerprint: `${errorType}:${frame}`,
    group: message.length > 120 ? message.slice(0, 120) : message,
  };
}

const REDACTED = '[REDACTED]';

// Anything that carries a credential: session cookies, bearer tokens/API keys
// and the internal proxy shared secret.
const SENSITIVE_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-internal-proxy-auth',
  'x-api-key',
]);

function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    redacted[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  }
  return redacted;
}

// Headers only: the pino `req` serializer (utils/logger.ts) rebuilds a fixed
// shape and carries `headers` across verbatim, dropping anything else we attach.
// pino's own `redact` covers cookie/authorization; this pass is what catches
// x-internal-proxy-auth, x-api-key and proxy-authorization on top of those.
function getRedactedRequestPayload(event: any) {
  return {
    headers: redactHeaders(event.node.req.headers ?? {}),
  };
}

/** reader/bot/monitor for a log line or an error counter. The telemetry plugin
 *  has normally already resolved it; this returns the memoised answer. */
function trafficFields(event: any): Record<string, string> {
  const { traffic, family } = resolveEventTraffic(event);
  return trafficAttributes(traffic, family);
}

/**
 * The distinct id `posthog-js` persists in the browser, read back so an SSR
 * exception lands on the SAME person as that reader's pageviews and their
 * client-side errors. This is the whole reason these go to PostHog rather than
 * staying in the logs: "the render 500ed, and here is what the person it
 * happened to did next" is not a question a log line can answer.
 *
 * The cookie name and shape are posthog-js's, not ours -- `ph_<token>_posthog`
 * holding JSON -- and it is client-controlled input, so every read is treated
 * as hostile. A malformed cookie costs us the attribution, never the report.
 */
function readPostHogIdentity(event: any, token: string): { distinctId?: string; sessionId?: string } {
  try {
    const raw = getCookie(event, `ph_${token}_posthog`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { distinct_id?: unknown; $sesid?: unknown };
    return {
      distinctId: typeof parsed.distinct_id === 'string' ? parsed.distinct_id : undefined,
      // `$sesid` is [lastActivityTs, sessionId, startTs]; only the id is useful
      // here, and it is what ties the exception to the session recording.
      sessionId: Array.isArray(parsed.$sesid) && typeof parsed.$sesid[1] === 'string' ? parsed.$sesid[1] : undefined,
    };
  } catch {
    return {};
  }
}

export default defineNitroPlugin((nitroApp) => {
  /**
   * SSR exceptions are the one failure the browser cannot report: the render
   * died before any JS shipped, so `posthog-js` never ran and the only record
   * of a reader getting a broken page is a log line -- no issue, no status, no
   * first/last-seen, nobody to attribute it to.
   *
   * Deliberately NOT `@posthog/nuxt`'s `enableExceptionAutocapture`, which
   * stays off in `nuxt.config.ts`. It hooks this same `error` hook but sends
   * EVERYTHING that reaches it -- every 404 h3 throws, every crawler probing
   * for `/wp-login.php` -- and stamps each one `$process_person_profile: false`
   * against a fresh uuid, so nothing it records can be traced back to a person.
   * The slice worth paying to ingest is 5xx from readers, and deciding that
   * needs the status code and the traffic class this file already computes.
   *
   * Absent outside production: the module is gated on `isProd`, which leaves
   * `public.posthog` undefined and makes every capture below a no-op -- the
   * same shape as `posthog.__loaded` guarding the client-side captures.
   */
  const runtimeConfig = useRuntimeConfig();
  const posthogPublicKey = (runtimeConfig.public.posthog as { publicKey?: string } | undefined)?.publicKey;
  const posthogHost = (runtimeConfig.public.posthog as { host?: string } | undefined)?.host;
  const appVersion = String(runtimeConfig.public.appVersion ?? 'unknown');

  // Through `t.nadeshiko.co` like everything else, which is the configured host
  // and does forward `/batch/` -- verified, because it was worth checking: the
  // proxy exists to keep content blockers from swallowing the BROWSER's reports,
  // and a server has no blockers to dodge, so nothing would have made this path
  // fail loudly if it only handled the paths posthog-js uses.
  const posthog = posthogPublicKey
    ? new PostHog(posthogPublicKey, {
        host: posthogHost,
        // The interesting bursts arrive during a bad deploy, which is exactly
        // when this container is about to be replaced. A small batch and a
        // short interval get them out ahead of SIGTERM rather than after it.
        flushAt: 5,
        flushInterval: 5000,
      })
    : null;

  /**
   * Two gates, both narrow on purpose.
   *
   * A request-scoped error is worth an issue only when it broke the page for a
   * person: 4xx is the caller's own doing (a stale link, a probe, a bad
   * param), and bot traffic outnumbers readers on exactly the URL shapes that
   * throw. Process-level faults have no event at all -- nitro routes
   * `uncaughtException` and `unhandledRejection` through this same hook -- and
   * those always matter, because the whole render process is now suspect.
   */
  const shouldCapture = (event: any, statusCode: number): boolean => {
    if (!event) return true;
    if (statusCode < 500) return false;
    return resolveEventTraffic(event).traffic === 'reader';
  };

  const captureException = (
    error: Error,
    event: any,
    details: { fingerprint: string; statusCode: number; method: string; url: string; tags: string[] },
  ): void => {
    if (!posthog || !posthogPublicKey) return;
    if (!shouldCapture(event, details.statusCode)) return;

    // Capturing must never be able to break error handling: whatever happens in
    // here, the log line and the counter above have already been emitted.
    try {
      const identity = event ? readPostHogIdentity(event, posthogPublicKey) : {};
      const requestId = event?.context?.requestId;

      posthog.captureException(error, identity.distinctId ?? requestId, {
        // The same string the `app.exception` counter carries as
        // `error.fingerprint`, so an issue here and a spike on the metric are
        // one object under two names. Left to itself PostHog would group by
        // exception type and stack, which for SSR means grouping by minified
        // chunk path -- it would not line up with the metric, and neither
        // could then confirm the other.
        $exception_fingerprint: details.fingerprint,
        $exception_level: 'error',
        // No cookie means no reader to attribute this to. Capture the error,
        // but do not manufacture a person out of a request id.
        ...(identity.distinctId ? {} : { $process_person_profile: false }),
        ...(identity.sessionId ? { $session_id: identity.sessionId } : {}),
        'http.route': normalizeRoute(details.url),
        'http.method': details.method,
        'http.status_code': details.statusCode,
        'http.url': details.url,
        // 'request' / 'plugin' / 'cache' / 'uncaughtException' / ... -- nitro's
        // own word for where this came from, and the only thing separating an
        // SSR render failure from a cache write that threw.
        'nitro.tags': details.tags.join(','),
        'service.name': 'nadeshiko-frontend',
        'service.version': appVersion,
        request_id: requestId,
        ...(event ? trafficFields(event) : {}),
      });
    } catch (captureError) {
      logger.warn({ err: captureError }, '[NITRO] failed to report an exception to PostHog');
    }
  };

  // Nitro flushes nothing on its own, and an unflushed batch is exactly the
  // report you wanted: the errors immediately before a shutdown.
  nitroApp.hooks.hook('close', async () => {
    await posthog?.shutdown();
  });

  // Add requestId to all requests
  nitroApp.hooks.hook('request', (event) => {
    event.context.requestId = crypto.randomUUID();
    event.context.startTime = Date.now();
  });

  // One line per request, emitted on the way out so it carries the status and
  // duration. The inbound side is deliberately not logged: it would double the
  // volume without adding a field this line doesn't already have.
  nitroApp.hooks.hook('afterResponse', (event) => {
    const req = event.node.req;
    const res = event.node.res;
    const url = req.url || 'unknown';
    const method = req.method || 'UNKNOWN';
    const statusCode = res.statusCode;
    const duration = Date.now() - (event.context.startTime || Date.now());

    const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    const logFn = logger[logLevel] || logger.info;

    logFn.call(
      logger,
      {
        type: 'response',
        method,
        url,
        statusCode,
        duration: `${duration}ms`,
        requestId: event.context.requestId,
        // One field per line is what makes `traffic:"bot"` a filter rather than
        // a User-Agent grep, and `bot.family` is what answers *which* crawler
        // once the metric moves.
        ...trafficFields(event),
      },
      `[NITRO] ${method} ${url} - ${statusCode} (${duration}ms)`,
    );
  });

  /**
   * The only error hook nitro has. Everything funnels through `captureError`
   * in `nitropack/dist/runtime/internal/app.mjs` and arrives here: h3's
   * `onError` for anything a handler threw (tagged `request`), plugin and
   * cache failures, and the process-level `uncaughtException` /
   * `unhandledRejection` pair, which come through with no event attached.
   *
   * There used to be a second hook here for `handlerError`. It never fired --
   * no such hook exists in nitropack 2.13.4 or h3 1.15.11, and grepping both
   * packages finds the name nowhere -- so it was counting nothing, logging
   * nothing, and implying a second layer of coverage that did not exist. The
   * `request`-tagged errors it was meant to catch already arrive here.
   */
  nitroApp.hooks.hook('error', (error, ctx) => {
    const event = ctx?.event;
    const context = event?.context;
    const url = event?.node?.req?.url || 'unknown';
    const method = event?.node?.req?.method || 'UNKNOWN';
    const errorType = error.constructor?.name || 'Error';
    const { fingerprint, group } = computeFingerprint(error, errorType);
    const statusCode = 'statusCode' in error ? (error.statusCode as number) : 500;
    const tags = (ctx as { tags?: string[] } | undefined)?.tags ?? [];

    errorCounter.add(1, {
      'error.fingerprint': fingerprint,
      'error.type': errorType,
      'error.severity': statusCode >= 500 ? '5xx' : '4xx',
      'error.group': group,
      'http.route': normalizeRoute(url),
      // An error burst that is entirely one crawler on a URL shape nobody links
      // to is a different morning from the same burst hitting readers.
      ...(event ? trafficFields(event) : {}),
    });

    logger.error(
      {
        err: error,
        type: 'error',
        method,
        url,
        req: event ? getRedactedRequestPayload(event) : undefined,
        requestId: context?.requestId,
        ...(event ? trafficFields(event) : {}),
        stack: error.stack,
        'error.fingerprint': fingerprint,
        'error.group': group,
      },
      `[NITRO] ${method} ${url} - ERROR: ${error.message}`,
    );

    captureException(error, event, { fingerprint, statusCode, method, url, tags });
  });
});
