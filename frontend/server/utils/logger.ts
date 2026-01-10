import pino from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';

// Helper function to partially redact sensitive values (show first 3 and last 3 characters)
const partialRedact = (value: unknown): string => {
  if (typeof value !== 'string') return '[REDACTED]';
  if (value.length <= 8) return '[REDACTED]';
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
};

const baseOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  timestamp: pino.stdTimeFunctions.isoTime,
  // Add more redaction paths from backend
  redact: [
    // Sensitive headers
    'req.headers.cookie',
    'req.headers.authorization',
    'req.headers.set-cookie',
    'req.headers.x-api-key',

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
    'req.body.code',

    // Sensitive data in response body
    'res.body.token',
    'res.body.key',
    'res.body.apiKey',
    'res.body.api_key',
    'res.body.accessToken',
    'res.body.access_token',
    'res.body.refreshToken',
    'res.body.refresh_token',

    // General fields
    'apiKey',
    'token',
    'password',
  ],
  formatters: {
    level: (label) => ({ level: label }),
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
      // Include requestId if available
      if ((req as any).requestId) {
        (serialized as any).requestId = (req as any).requestId;
      }
      return serialized;
    },
    res: pino.stdSerializers.res,
  },
};

export const logger = pino(baseOptions);
export const createLogger = (context: string) => logger.child({ context });

export default logger;
