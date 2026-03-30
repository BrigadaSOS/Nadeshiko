import pino from 'pino';
import pinoHttp from 'pino-http';
import { basename } from 'path';
import { trace } from '@opentelemetry/api';
import { config } from '@config/config';

const normalizedEnvironment = (config.ENVIRONMENT || '').trim().toLowerCase();
const isDevelopment = normalizedEnvironment === 'local' || normalizedEnvironment === 'dev';

export function shouldUsePrettyLogsForEntrypoint(entrypointArg?: string): boolean {
  const entrypoint = basename(entrypointArg ?? process.argv[1] ?? '');
  return (
    entrypoint === 'db.ts' || entrypoint === 'es.ts' || entrypoint === 'setup.ts' || entrypoint === 'dbBootstrap.ts'
  );
}

const usePrettyLogs = shouldUsePrettyLogsForEntrypoint();

// Helper function to safely parse JSON, returns original value if parsing fails
export const safeParseJson = (value: string): any => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const baseOptions: pino.LoggerOptions = {
  level: config.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  },
  redact: [
    // Sensitive headers
    'req.headers.cookie',
    'req.headers.authorization',
    'req.headers.set-cookie',

    // Common PII in query params
    'req.query.password',
    'req.query.token',
    'req.query.api_key',
    'req.query.apiKey',
    'req.query.access_token',
    'req.query.refresh_token',
    'req.query.email',
    'req.query.code',

    // Common PII in request body
    'req.body.password',
    'req.body.currentPassword',
    'req.body.newPassword',
    'req.body.token',
    'req.body.accessToken',
    'req.body.refreshToken',
    'req.body.refresh_token',
    'req.body.apiKey',
    'req.body.api_key',
    'req.body.secret',
    'req.body.email',
    'req.body.code', // OAuth codes
    'req.body.username', // Potential PII

    // Sensitive data in response body - tokens and keys
    'res.body.token', // Authentication tokens
    'res.body.key', // API keys
    'res.body.apiKey',
    'res.body.api_key',
    'res.body.accessToken',
    'res.body.access_token',
    'res.body.refreshToken',
    'res.body.refresh_token',

    // User PII in response body
    'res.body.user.email',
    'res.body.user.username',

    // Verbose content in response body (search results)
    'res.body.sentences',
    'res.body.mediaStatistics',
    'res.body.categoryStatistics',
    'res.body.posAnalysis',
    'res.body.revisions',
  ],

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

export function buildHttpLoggerOptions(currentLogger = logger) {
  return {
    logger: currentLogger,
    serializers: {
      req: (req: any) => {
        // pino-http wraps the request, so we need to access req.raw for the Express request
        const rawReq = req.raw || req;
        const serialized = pino.stdSerializers.req(req);
        // Strip sensitive query params from the logged URL
        if (serialized.url) {
          try {
            const parsed = new URL(serialized.url, 'http://localhost');
            for (const param of ['token', 'access_token', 'refresh_token', 'api_key', 'apiKey', 'code']) {
              if (parsed.searchParams.has(param)) {
                parsed.searchParams.set(param, '[Redacted]');
              }
            }
            serialized.url = `${parsed.pathname}${parsed.search}`;
          } catch {
            // leave url as-is if parsing fails
          }
        }
        // Include requestId if available
        if ((rawReq as any).requestId) {
          (serialized as any).requestId = (rawReq as any).requestId;
        }
        // Include raw body if captured by rawBodySaver middleware
        // Parse string to object so pino redact paths work properly
        if ((rawReq as any).rawBody) {
          (serialized as any).body = safeParseJson((rawReq as any).rawBody);
        }
        return serialized;
      },
      res: (res: any) => {
        // pino-http wraps the response, so we need to access res.raw for the Express response
        const raw = res.raw || res;
        const serialized: any = {
          statusCode: raw.statusCode,
          headers: raw.getHeaders ? raw.getHeaders() : {},
        };
        // Include response body if captured by responseBodyLogger middleware
        // Parse string to object so pino redact paths work properly
        if (raw.responseBody !== undefined) {
          serialized.body = typeof raw.responseBody === 'string' ? safeParseJson(raw.responseBody) : raw.responseBody;
        }
        return serialized;
      },
    },
    customLogLevel: (_req: any, res: any, err: any) => {
      const statusCode = res.statusCode;
      if (err || statusCode >= 500) {
        return 'error';
      } else if (statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    customSuccessMessage: (req: any, res: any) =>
      `${req.method || 'UNKNOWN'} ${req.url || 'UNKNOWN'} completed with ${res.statusCode}`,
    customErrorMessage: (req: any, res: any, error: any) =>
      `${req.method || 'UNKNOWN'} ${req.url || 'UNKNOWN'} failed with ${res.statusCode} - ${error?.message}`,
  };
}

// HTTP request logger configuration
export const httpLogger = pinoHttp(buildHttpLoggerOptions(logger) as any);

export default logger;
