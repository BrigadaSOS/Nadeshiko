import { metrics } from '@opentelemetry/api';
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

export default defineNitroPlugin((nitroApp) => {
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

  nitroApp.hooks.hook('error', (error, ctx) => {
    const event = ctx?.event;
    const context = event?.context;
    const url = event?.node?.req?.url || 'unknown';
    const method = event?.node?.req?.method || 'UNKNOWN';
    const errorType = error.constructor?.name || 'Error';
    const { fingerprint, group } = computeFingerprint(error, errorType);
    const statusCode = 'statusCode' in error ? (error.statusCode as number) : 500;

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
  });

  nitroApp.hooks.hook('handlerError', (error, event) => {
    const url = event.node.req.url || 'unknown';
    const method = event.node.req.method || 'UNKNOWN';
    const errorType = error.constructor?.name || 'Error';
    const { fingerprint, group } = computeFingerprint(error, errorType);
    const statusCode = 'statusCode' in error ? (error.statusCode as number) : 500;

    errorCounter.add(1, {
      'error.fingerprint': fingerprint,
      'error.type': errorType,
      'error.severity': statusCode >= 500 ? '5xx' : '4xx',
      'error.group': group,
      'http.route': normalizeRoute(url),
      ...trafficFields(event),
    });

    logger.error(
      {
        err: error,
        type: 'handlerError',
        method,
        url,
        req: getRedactedRequestPayload(event),
        requestId: event.context.requestId,
        ...trafficFields(event),
        stack: error.stack,
        'error.fingerprint': fingerprint,
        'error.group': group,
      },
      `[NITRO] ${method} ${url} - HANDLER ERROR: ${error.message}`,
    );
  });
});
