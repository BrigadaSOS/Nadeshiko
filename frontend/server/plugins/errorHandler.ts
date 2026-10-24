import { sanitizeRequestUrl } from '@brigadasos/nadeshiko-shared/logRedaction';
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

  const fingerprint = `${errorType}:${frame}`;

  // Keep metric cardinality bounded: messages contain user input and unique IDs. Stable source fingerprints
  // group metrics while logs/PostHog retain the full message.
  return { fingerprint, group: fingerprint };
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

// The pino req serializer preserves only headers; redact proxy/API secrets beyond pino's cookie/authorization rules.
function getRedactedRequestPayload(event: any) {
  return {
    headers: redactHeaders(event.node.req.headers ?? {}),
  };
}

function trafficFields(event: any): Record<string, string> {
  const { traffic, family } = resolveEventTraffic(event);
  return trafficAttributes(traffic, family);
}

// Treat the client-controlled PostHog JSON cookie as hostile. Malformed identity loses attribution, not the report.
function readPostHogIdentity(event: any, token: string): { distinctId?: string; sessionId?: string } {
  try {
    const raw = getCookie(event, `ph_${token}_posthog`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { distinct_id?: unknown; $sesid?: unknown };
    return {
      distinctId: typeof parsed.distinct_id === 'string' ? parsed.distinct_id : undefined,
      // posthog-js $sesid is [lastActivityTs, sessionId, startTs].
      sessionId: Array.isArray(parsed.$sesid) && typeof parsed.$sesid[1] === 'string' ? parsed.$sesid[1] : undefined,
    };
  } catch {
    return {};
  }
}

export default defineNitroPlugin((nitroApp) => {
  // Report SSR failures the browser never sees. Do not enable broad PostHog Nitro autocapture: it includes crawler
  // 4xx noise and lacks reader attribution. Missing production configuration keeps capture disabled.
  const runtimeConfig = useRuntimeConfig();
  const posthogPublicKey = (runtimeConfig.public.posthog as { publicKey?: string } | undefined)?.publicKey;
  const posthogHost = (runtimeConfig.public.posthog as { host?: string } | undefined)?.host;
  const appVersion = String(runtimeConfig.public.appVersion ?? 'unknown');

  // Disable external reporting for production-mode fixtures, while preserving real logs and metrics.
  const posthog =
    posthogPublicKey && process.env.NADESHIKO_POSTHOG_DISABLED !== '1'
      ? new PostHog(posthogPublicKey, {
          host: posthogHost,
          // Flush small batches promptly so pre-shutdown deploy errors reach PostHog.
          flushAt: 5,
          flushInterval: 5000,
        })
      : null;

  // Capture reader 5xx failures, not crawler/4xx noise. Event-less process faults always matter.
  const shouldCapture = (event: any, statusCode: number, url: string): boolean => {
    if (!event) return true;
    if (statusCode < 500) return false;
    // Word-card 503s recover as optional enrichment; keep logs/metrics but avoid manufacturing a PostHog issue.
    if (statusCode === 503 && url.startsWith('/api/shirabe/words/candidates/')) return false;
    return resolveEventTraffic(event).traffic === 'reader';
  };

  const captureException = (
    error: Error,
    event: any,
    details: { fingerprint: string; statusCode: number; method: string; url: string; tags: string[] },
  ): void => {
    if (!posthog || !posthogPublicKey) return;
    if (!shouldCapture(event, details.statusCode, details.url)) return;

    // Reporting must not break error handling after logs and metrics have already been emitted.
    try {
      const identity = event ? readPostHogIdentity(event, posthogPublicKey) : {};
      const requestId = event?.context?.requestId;

      posthog.captureException(error, identity.distinctId ?? requestId, {
        // Use the metric fingerprint so error-tracking issues correlate with exception spikes.
        $exception_fingerprint: details.fingerprint,
        $exception_level: 'error',
        // Without a reader identity, capture the error without manufacturing a person from a request ID.
        ...(identity.distinctId ? {} : { $process_person_profile: false }),
        ...(identity.sessionId ? { $session_id: identity.sessionId } : {}),
        'http.route': normalizeRoute(details.url),
        'http.method': details.method,
        'http.status_code': details.statusCode,
        'http.url': details.url,

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

  // Flush the final batch on shutdown.
  nitroApp.hooks.hook('close', async () => {
    await posthog?.shutdown();
  });

  nitroApp.hooks.hook('request', (event) => {
    event.context.requestId = crypto.randomUUID();
    event.context.startTime = Date.now();
  });

  // Log once after response so status/duration are known; an inbound line only doubles volume.
  nitroApp.hooks.hook('afterResponse', (event) => {
    const req = event.node.req;
    const res = event.node.res;
    // Magic-link, OAuth and email-preference URLs carry their credential in the query string.
    const url = req.url ? sanitizeRequestUrl(req.url) : 'unknown';
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

        ...trafficFields(event),
      },
      `[NITRO] ${method} ${url} - ${statusCode} (${duration}ms)`,
    );
  });

  // Nitro request, plugin, cache and process faults share the error hook; process faults may have no event.
  nitroApp.hooks.hook('error', (error, ctx) => {
    const event = ctx?.event;
    const context = event?.context;
    // Sanitized once here because it reaches the log line and PostHog's `http.url` alike.
    const rawUrl = event?.node?.req?.url;
    const url = rawUrl ? sanitizeRequestUrl(rawUrl) : 'unknown';
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
