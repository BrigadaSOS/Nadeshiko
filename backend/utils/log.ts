import pino from 'pino';
import pinoHttp from 'pino-http';

// Determine if we're in development environment
const isDevelopment = process.env.ENVIRONMENT === 'testing' || process.env.NODE_ENV === 'development';

// Helper function to partially redact sensitive values (show first 3 and last 3 characters)
const partialRedact = (value: unknown): string => {
  if (typeof value !== 'string') return '[REDACTED]';
  if (value.length <= 8) return '[REDACTED]';
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
};

// Create base logger configuration
const baseOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),

  // Add timestamp and error serialization
  timestamp: pino.stdTimeFunctions.isoTime,

  // Redact sensitive information (completely remove these paths)
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

  // Serialize errors properly
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

  // In production, use JSON; in development, use pretty print
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined, // Default JSON output for production
};

// Create the main logger instance
export const logger = pino(baseOptions);

// Create child loggers for specific contexts
export const createLogger = (context: string) =>
  logger.child({ context });

// HTTP request logger configuration
export const httpLogger = pinoHttp({
  logger,

  // Custom request serializer for partial redaction of API keys
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

  // Custom request logging
  customLogLevel: (_req: any, res: any, err: any) => {
    const statusCode = res.statusCode;
    if (err || statusCode >= 500) {
      return 'error';
    } else if (statusCode >= 400) {
      return 'warn';
    }
    return 'info';
  },

  // Custom success message
  customSuccessMessage: function (req: any, res: any) {
    return `${req.method || 'UNKNOWN'} ${req.url || 'UNKNOWN'} completed with ${res.statusCode}`;
  },

  // Custom error message
  customErrorMessage: function (req: any, res: any, error: any) {
    return `${req.method || 'UNKNOWN'} ${req.url || 'UNKNOWN'} failed with ${res.statusCode} - ${error?.message}`;
  },
} as any);

// Export a default logger for backward compatibility
export default logger;
