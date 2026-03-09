import { trace, SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('nadeshiko-frontend');

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const req = event.node.req;
    const span = tracer.startSpan(`${req.method} ${req.url}`, {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': req.method || 'UNKNOWN',
        'http.url': req.url || 'unknown',
      },
    });
    event.context._otelSpan = span;
  });

  nitroApp.hooks.hook('afterResponse', (event) => {
    const span = event.context._otelSpan as Span | undefined;
    if (!span) return;

    span.setAttribute('http.status_code', event.node.res.statusCode);
    if (event.node.res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.end();
  });

  nitroApp.hooks.hook('error', (error, { event }) => {
    const span = event?.context?._otelSpan as Span | undefined;
    if (!span) return;

    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  });
});
