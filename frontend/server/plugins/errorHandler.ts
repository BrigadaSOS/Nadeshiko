import { createLogger } from '../utils/logger';

const logger = createLogger('nitro:http');

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

function getRedactedRequestPayload(event: any) {
  return {
    headers: event.node.req.headers,
    body: getRequestBody(event),
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
  nitroApp.hooks.hook('afterResponse', (event, { body }) => {
    const req = event.node.req;
    const res = event.node.res;
    const url = req.url || 'unknown';
    const method = req.method || 'UNKNOWN';
    const statusCode = res.statusCode;
    const duration = Date.now() - (event.context.startTime || Date.now());

    // Determine log level based on status code
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

  // Log unhandled errors
  nitroApp.hooks.hook('error', (error, { event }) => {
    const context = event?.context;
    const url = event?.node?.req?.url || 'unknown';
    const method = event?.node?.req?.method || 'UNKNOWN';

    logger.error(
      {
        err: error,
        type: 'error',
        method,
        url,
        req: getRedactedRequestPayload(event),
        requestId: context?.requestId,
        stack: error.stack,
      },
      `[NITRO] ${method} ${url} - ERROR: ${error.message}`,
    );
  });

  // Log errors that happen during request handling
  nitroApp.hooks.hook('handlerError', (error, event) => {
    const url = event.node.req.url || 'unknown';
    const method = event.node.req.method || 'UNKNOWN';

    logger.error(
      {
        err: error,
        type: 'handlerError',
        method,
        url,
        req: getRedactedRequestPayload(event),
        requestId: event.context.requestId,
        stack: error.stack,
      },
      `[NITRO] ${method} ${url} - HANDLER ERROR: ${error.message}`,
    );
  });
});
