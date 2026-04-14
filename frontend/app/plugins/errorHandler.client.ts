import { SpanStatusCode } from '@opentelemetry/api';
import type { Counter, Tracer } from '@opentelemetry/api';
import { getPagePath } from '~/utils/pagePath';

const BROWSER_FRAME_RE = /at .+?\((.+?):\d+:\d+\)|at (.+?):\d+:\d+|@(.+?):\d+:\d+/;

function computeBrowserFingerprint(
  error: unknown,
  errorType: string,
): { fingerprint: string; group: string } {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  let frame = 'unknown';
  if (stack) {
    for (const line of stack.split('\n')) {
      const match = line.trim().match(BROWSER_FRAME_RE);
      const filePath = match?.[1] || match?.[2] || match?.[3];
      if (filePath) {
        frame = filePath.replace(/:\d+:\d+$/, '').replace(/[?#].*$/, '');
        break;
      }
    }
  }

  return {
    fingerprint: `${errorType}:${frame}`,
    group: message.length > 120 ? message.slice(0, 120) : message,
  };
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return 'Unknown error';
}

function getComponentName(value: unknown): string {
  if (value && typeof value === 'object') {
    const component = value as { $options?: { name?: string }; $type?: { name?: string } };
    return component.$options?.name || component.$type?.name || 'Unknown';
  }
  return 'Unknown';
}

function reportError(
  tracer: Tracer | undefined,
  errorCounter: Counter | undefined,
  name: string,
  error: unknown,
  attributes?: Record<string, string>,
) {
  console.error(`[${name}]`, error);

  const { fingerprint, group } = computeBrowserFingerprint(error, name);

  errorCounter?.add(1, {
    'error.fingerprint': fingerprint,
    'error.type': name,
    'error.severity': 'exception',
    'page.path': getPagePath(),
  });

  if (!tracer) return;

  const span = tracer.startSpan(name, {
    attributes: {
      'error.type': name,
      'error.fingerprint': fingerprint,
      'error.group': group,
      'browser.url': window.location.href,
      ...attributes,
    },
  });

  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR, message: getErrorMessage(error) });
  span.end();
}

export default defineNuxtPlugin({
  name: 'errorHandler',
  dependsOn: ['otel'],
  setup(nuxtApp) {
    const tracer = nuxtApp.$otelTracer as Tracer | undefined;
    const errorCounter = nuxtApp.$otelErrorCounter as Counter | undefined;

    nuxtApp.vueApp.config.errorHandler = (err, instance, info) => {
      reportError(tracer, errorCounter, 'vue:error', err, {
        'vue.info': info || '',
        'vue.component': getComponentName(instance),
      });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event) => {
        reportError(tracer, errorCounter, 'unhandledRejection', event.reason);
      });

      window.addEventListener('error', (event) => {
        reportError(tracer, errorCounter, 'global:error', event.error || event.message, {
          'error.filename': event.filename || '',
          'error.lineno': String(event.lineno || 0),
          'error.colno': String(event.colno || 0),
        });
      });
    }
  },
});
