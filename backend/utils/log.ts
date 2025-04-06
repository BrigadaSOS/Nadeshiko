import winston from 'winston';
import expressWinston from 'express-winston';

const baseTransports = [new winston.transports.Console({ level: 'debug' })];

const baseFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.splat(),
  winston.format.errors(),
  winston.format.prettyPrint(),
);

export const expressWinstonLogger = expressWinston.errorLogger({
  transports: baseTransports,
  format: baseFormat,
});

export const expressWinstonErrorLogger = expressWinston.errorLogger({
  transports: baseTransports,
  format: baseFormat,
});

export const logger = winston.createLogger({
  transports: baseTransports,
  format: baseFormat,
});
