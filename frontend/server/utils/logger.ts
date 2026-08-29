import pino from 'pino';
import { trace, context } from '@opentelemetry/api';
import { REDACT_PATHS } from '@brigadasos/nadeshiko-shared/logRedaction';

const isDevelopment = process.env.NODE_ENV !== 'production';

const baseOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    const span = trace.getSpan(context.active());
    if (span) {
      const { traceId, spanId, traceFlags } = span.spanContext();
      return { trace_id: traceId, span_id: spanId, trace_flags: `0${traceFlags.toString(16)}` };
    }
    return {};
  },
  redact: [...REDACT_PATHS],
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: (req: any) => {
      const serialized = pino.stdSerializers.req(req);
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
