import pino from 'pino';

const isDevelopment = (process.env.NODE_ENV || 'development') === 'development';

const baseOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
};

const loggerOptions: pino.LoggerOptions = isDevelopment
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

const logger = pino(loggerOptions);
export const createLogger = (context: string) => logger.child({ context });
