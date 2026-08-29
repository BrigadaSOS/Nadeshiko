import pino from 'pino';
import pinoHttp from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Request, Response } from 'express';
import { basename } from 'path';
import { createRequire } from 'module';
import { trace, context } from '@opentelemetry/api';
import { config } from '@config/config';
import { hashUserId } from '@lib/userLogHash';
import { REDACT_PATHS } from '@brigadasos/nadeshiko-shared/logRedaction';

const normalizedEnvironment = (config.ENVIRONMENT || '').trim().toLowerCase();
const isDevelopment = normalizedEnvironment === 'local' || normalizedEnvironment === 'development';

export function shouldUsePrettyLogsForEntrypoint(entrypointArg?: string): boolean {
  const entrypoint = basename(entrypointArg ?? process.argv[1] ?? '');
  return (
    entrypoint === 'db.ts' || entrypoint === 'es.ts' || entrypoint === 'setup.ts' || entrypoint === 'dbBootstrap.ts'
  );
}

/**
 * Pretty logs are for a human watching a CLI script, and `pino-pretty` is a
 * devDependency -- so it is present when one is, and absent from the deployed
 * image. But these scripts also run IN that image, as one-off jobs: an ES
 * reindex, a migration. Asking pino for a transport that is not installed throws
 * while the module is still being imported, which killed the script before it
 * could report anything ("unable to determine transport target for pino-pretty")
 * and made every one of these entrypoints unrunnable in staging and production.
 *
 * So the entrypoint decides whether pretty output is WANTED, and this decides
 * whether it is possible. Absent, the script keeps the structured logger it
 * would have had anyway.
 */
function prettyTransportAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

const usePrettyLogs = shouldUsePrettyLogsForEntrypoint() && prettyTransportAvailable();

// Helper function to safely parse JSON, returns original value if parsing fails
export const safeParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/**
 * Bodies larger than this are logged as a marker instead of their content. The
 * JSON body limit is 10mb, and access logs run at info level on every request,
 * so an uncapped body is both a log-volume problem and a retention problem (the
 * captured copy lives on the request object for the life of the request).
 *
 * Oversized bodies are replaced wholesale rather than clipped: a prefix would
 * leak content past the `redact` paths, which only apply to parsed fields.
 */
export const MAX_LOGGED_BODY_BYTES = 16 * 1024;

export const oversizedBodyPlaceholder = (bytes: number): string =>
  `[Body omitted: ${bytes} bytes exceeds the ${MAX_LOGGED_BODY_BYTES} byte log limit]`;

function loggedBodyByteLength(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (Buffer.isBuffer(value)) return value.length;
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    // Circular or otherwise unserializable: leave it to pino.
    return 0;
  }
}

export function capLoggedBody(value: unknown): unknown {
  const bytes = loggedBodyByteLength(value);
  return bytes > MAX_LOGGED_BODY_BYTES ? oversizedBodyPlaceholder(bytes) : value;
}

/**
 * Not secrets -- response shapes that are simply too big to log. A search
 * response carries every segment it matched, and one of those lines is worth
 * more to the log bill than to anybody reading it.
 *
 * Separate from the shared `REDACT_PATHS` because these are the API's own
 * payloads: the frontend proxies them but never names them, and a path in this
 * list going stale costs a verbose log line, not an exposed credential.
 */
const VERBOSE_RESPONSE_PATHS = [
  'res.body.segments',
  'res.body.media',
  'res.body.categories',
  'res.body.results',
  'res.body.includes',
  'res.body.revisions',
];

const baseOptions: pino.LoggerOptions = {
  level: config.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: [...REDACT_PATHS, ...VERBOSE_RESPONSE_PATHS],

  mixin() {
    const span = trace.getSpan(context.active());
    if (span) {
      const { traceId, spanId, traceFlags } = span.spanContext();
      return { trace_id: traceId, span_id: spanId, trace_flags: `0${traceFlags.toString(16)}` };
    }
    return {};
  },
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
};

const loggerOptions: pino.LoggerOptions = usePrettyLogs
  ? {
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }
  : baseOptions;

export const logger = pino(loggerOptions);
export const createLogger = (context: string) => logger.child({ context });

/**
 * pino-http hands the serializers either the raw Node request or its own wrapper
 * holding one on `.raw`, depending on where in the lifecycle it fires. These
 * aliases name that union once instead of falling back to `any` at each callback.
 */
type PinoRequest = (IncomingMessage | Request) & { raw?: IncomingMessage | Request };
type PinoResponse = (ServerResponse | Response) & { raw?: ServerResponse | Response };

function unwrapRequest(req: PinoRequest): Partial<Request> {
  return (req.raw ?? req) as Partial<Request>;
}

function unwrapResponse(res: PinoResponse): Partial<Response> & { statusCode: number } {
  return (res.raw ?? res) as Partial<Response> & { statusCode: number };
}

const SENSITIVE_QUERY_PARAMETERS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'email',
  'code',
]);

/**
 * Keep the path and non-sensitive query context useful to operators without
 * allowing credentials embedded in a URL to escape into any log field.
 */
export function sanitizeRequestUrl(url: string): string;
export function sanitizeRequestUrl(url: undefined): undefined;
export function sanitizeRequestUrl(url: string | undefined): string | undefined;
export function sanitizeRequestUrl(url: string | undefined): string | undefined {
  if (!url) return url;

  try {
    const parsed = new URL(url, 'http://localhost');
    for (const [name] of parsed.searchParams) {
      if (SENSITIVE_QUERY_PARAMETERS.has(name.toLowerCase())) {
        parsed.searchParams.set(name, '[Redacted]');
      }
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    // A malformed URL must not make logging leak its unparsed query string.
    return url.split('?', 1)[0];
  }
}

export function buildHttpLoggerOptions(currentLogger = logger) {
  return {
    logger: currentLogger,
    serializers: {
      req: (req: PinoRequest) => {
        // pino-http wraps the request, so we need to access req.raw for the Express request
        const rawReq = unwrapRequest(req);
        const serialized = pino.stdSerializers.req(req);
        serialized.url = sanitizeRequestUrl(serialized.url);
        // requestId and rawBody are attached by our own middleware; both are
        // declared on Express's Request in lib/express_ext/express.d.ts.
        const extras: { requestId?: string; body?: unknown } = {};
        if (rawReq.requestId) {
          extras.requestId = rawReq.requestId;
        }
        // Parse the string to an object so pino redact paths can reach into it.
        if (rawReq.rawBody) {
          extras.body = safeParseJson(rawReq.rawBody);
        }
        return { ...serialized, ...extras };
      },
      res: (res: PinoResponse) => {
        const raw = unwrapResponse(res);
        const serialized: { statusCode: number; headers: unknown; body?: unknown } = {
          statusCode: raw.statusCode,
          headers: raw.getHeaders ? raw.getHeaders() : {},
        };
        // Only error responses carry their body into the log; success bodies are
        // large, uninteresting, and the most likely to hold personal data.
        if (raw.statusCode >= 400 && raw.responseBody !== undefined) {
          serialized.body = capLoggedBody(
            typeof raw.responseBody === 'string' ? safeParseJson(raw.responseBody) : raw.responseBody,
          );
        }
        return serialized;
      },
    },
    customProps: (req: PinoRequest, res: PinoResponse) => {
      const rawReq = unwrapRequest(req);
      const props: Record<string, unknown> = {
        'http.method': rawReq.method,
        'http.url': sanitizeRequestUrl(rawReq.url),
        'http.status_code': res.statusCode,
        'http.response_time': res.getHeader?.('x-response-time'),
      };
      if (rawReq.requestId) {
        props['http.request_id'] = rawReq.requestId;
      }
      if (rawReq.route?.path) {
        props['http.route'] = rawReq.route.path;
      }
      // Set by trafficClassification, which is mounted before this logger.
      // `bot.family` is only on the log line, never on the request metrics:
      // breadth costs nothing in a log field and it is the thing that answers
      // *which* crawler once a metric moves.
      if (rawReq.traffic) {
        props.traffic = rawReq.traffic;
      }
      if (rawReq.botFamily) {
        props['bot.family'] = rawReq.botFamily;
      }
      // Set by the auth middleware, which has run by the time this is evaluated
      // (pino-http builds the props on response finish, not on the way in).
      // Pseudonymous and salted -- see @lib/userLogHash for why it is not the
      // id, the email, or nothing at all. Absent when LOG_USER_SALT is unset,
      // and absent for anonymous traffic, which is most of it.
      if (rawReq.user?.id) {
        const userHash = hashUserId(rawReq.user.id);
        if (userHash) {
          props['user.hash'] = userHash;
        }
      }
      // Which key was used, when one was. Already non-identifying (better-auth
      // ids are random), and it is what separates "this account is busy" from
      // "one of this account's four integrations is stuck in a retry loop" --
      // the shape the quota complaint that prompted this turned out to have.
      if (rawReq.auth?.apiKey?.id) {
        props['apikey.id'] = rawReq.auth.apiKey.id;
      }
      return props;
    },
    customLogLevel: (_req: PinoRequest, res: PinoResponse, err?: Error) => {
      const statusCode = res.statusCode;
      if (err || statusCode >= 500) {
        return 'error';
      } else if (statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    customSuccessMessage: (req: PinoRequest, res: PinoResponse) => {
      const rawReq = unwrapRequest(req);
      return `${rawReq.method || 'UNKNOWN'} ${sanitizeRequestUrl(rawReq.url) || 'UNKNOWN'} completed with ${res.statusCode}`;
    },
    customErrorMessage: (req: PinoRequest, res: PinoResponse, error?: Error) => {
      const rawReq = unwrapRequest(req);
      return `${rawReq.method || 'UNKNOWN'} ${sanitizeRequestUrl(rawReq.url) || 'UNKNOWN'} failed with ${res.statusCode} - ${error?.message}`;
    },
  };
}

// HTTP request logger configuration
export const httpLogger = pinoHttp(buildHttpLoggerOptions(logger));

export default logger;
