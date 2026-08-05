import { metrics } from '@opentelemetry/api';
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

// Helper to safely parse JSON
function safeParseJson(value: string | undefined | null): any {
  if (!value) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Helper to get request body from Nitro event
function getRequestBody(event: any): any {
  // Try to get body from different places depending on the request type
  const body = event.context.body || event._requestBody || (event.node as any).req?.body;
  if (typeof body === 'string') {
    return safeParseJson(body);
  }
  return body;
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

const SENSITIVE_BODY_KEY = /^(password|newpassword|token|refreshtoken|secret|apikey|api_key|authorization|cookie)$/i;

const MAX_BODY_DEPTH = 4;

function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    redacted[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  }
  return redacted;
}

function redactBody(body: any, depth = 0): any {
  if (!body || typeof body !== 'object' || depth >= MAX_BODY_DEPTH) return body;
  if (Array.isArray(body)) return body.map((entry) => redactBody(entry, depth + 1));

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    redacted[key] = SENSITIVE_BODY_KEY.test(key) ? REDACTED : redactBody(value, depth + 1);
  }
  return redacted;
}

// Bodies are only attached to error logs -- a successful request never needs
// its payload in the log stream. Note the pino `req` serializer (utils/logger.ts)
// keeps a fixed shape and drops the body, so the redaction that actually reaches
// the output today is the header one.
function getRedactedRequestPayload(event: any, { includeBody = false }: { includeBody?: boolean } = {}) {
  return {
    headers: redactHeaders(event.node.req.headers ?? {}),
    body: includeBody ? redactBody(getRequestBody(event)) : undefined,
  };
}

export default defineNitroPlugin((nitroApp) => {
  // Add requestId to all requests
  nitroApp.hooks.hook('request', (event) => {
    event.context.requestId = crypto.randomUUID();
    event.context.startTime = Date.now();
  });

  // Log all incoming requests
  nitroApp.hooks.hook('beforeHandle', (event) => {
    const req = event.node.req;
    const url = req.url || 'unknown';
    const method = req.method || 'UNKNOWN';

    // Log request with body
    logger.info(
      {
        type: 'request',
        method,
        url,
        req: getRedactedRequestPayload(event),
        requestId: event.context.requestId,
      },
      `[NITRO] ${method} ${url}`,
    );
  });

  // Log all responses (including errors)
  nitroApp.hooks.hook('afterResponse', (event, response) => {
    const body = response?.body;
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
        res: {
          body: logLevel !== 'info' ? body : undefined, // Only log body for errors
        },
        requestId: event.context.requestId,
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
    });

    logger.error(
      {
        err: error,
        type: 'error',
        method,
        url,
        req: event ? getRedactedRequestPayload(event, { includeBody: true }) : undefined,
        requestId: context?.requestId,
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
    });

    logger.error(
      {
        err: error,
        type: 'handlerError',
        method,
        url,
        req: getRedactedRequestPayload(event, { includeBody: true }),
        requestId: event.context.requestId,
        stack: error.stack,
        'error.fingerprint': fingerprint,
        'error.group': group,
      },
      `[NITRO] ${method} ${url} - HANDLER ERROR: ${error.message}`,
    );
  });
});
