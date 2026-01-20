import pino from 'pino';
import pinoHttp from 'pino-http';

const isDevelopment = process.env.ENVIRONMENT === 'testing' || process.env.NODE_ENV === 'development';

// Helper function to partially redact sensitive values (show first 3 and last 3 characters)
const partialRedact = (value: unknown): string => {
  if (typeof value !== 'string') return '[REDACTED]';
  if (value.length <= 8) return '[REDACTED]';
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
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

    // Common PII in request body
    'req.body.password',
    'req.body.currentPassword',
    'req.body.newPassword',
    'req.body.token',
    'req.body.accessToken',
    'req.body.refreshToken',
    'req.body.apiKey',
    'req.body.api_key',
    'req.body.secret',
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
      const serialized = pino.stdSerializers.req(req);
      // Partially redact API key if present
      if (req.headers?.['x-api-key']) {
        serialized.headers = { ...serialized.headers, 'x-api-key': partialRedact(req.headers['x-api-key']) };
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
