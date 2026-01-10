import pino from 'pino';
import pinoHttp from 'pino-http';

const isDevelopment = process.env.ENVIRONMENT === 'testing' || process.env.NODE_ENV === 'development';

// Helper function to partially redact sensitive values (show first 3 and last 3 characters)
const partialRedact = (value: unknown): string => {
  if (typeof value !== 'string') return '[REDACTED]';
  if (value.length <= 8) return '[REDACTED]';
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
};

// Helper function to safely parse JSON, returns original value if parsing fails
const safeParseJson = (value: string): any => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const baseOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  timestamp: pino.stdTimeFunctions.isoTime,
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
    'res.body.token', // JWT tokens
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

    // Sentence content in response body (search results)
    'res.body.sentences',
    'res.body.statistics',
    'res.body.categoryStatistics',
  ],

  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: (req: any) => {
      const serialized = pino.stdSerializers.req(req);
      // Partially redact API key if present
      if (req.headers?.['x-api-key']) {
        serialized.headers = { ...serialized.headers, 'x-api-key': partialRedact(req.headers['x-api-key']) };
      }
      return serialized;
    },
    res: pino.stdSerializers.res,
  },
};

export const logger = pino(baseOptions);
export const createLogger = (context: string) => logger.child({ context });

// HTTP request logger configuration
export const httpLogger = pinoHttp({
  logger,
  serializers: {
    req: (req: any) => {
      // pino-http wraps the request, so we need to access req.raw for the Express request
      const rawReq = req.raw || req;
      const serialized = pino.stdSerializers.req(req);
      // Partially redact API key if present
      if (rawReq.headers?.['x-api-key']) {
        serialized.headers = { ...serialized.headers, 'x-api-key': partialRedact(rawReq.headers['x-api-key']) };
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
  customSuccessMessage: function (req: any, res: any) {
    return `${req.method || 'UNKNOWN'} ${req.url || 'UNKNOWN'} completed with ${res.statusCode}`;
  },
  customErrorMessage: function (req: any, res: any, error: any) {
    return `${req.method || 'UNKNOWN'} ${req.url || 'UNKNOWN'} failed with ${res.statusCode} - ${error?.message}`;
  },
} as any);

export default logger;
