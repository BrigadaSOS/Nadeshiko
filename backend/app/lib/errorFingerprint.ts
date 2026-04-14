import { trace, SpanStatusCode } from '@opentelemetry/api';
import { getMeter } from '@config/telemetry';

const SKIP_PATTERNS = [/node_modules\//, /node:internal\//, /<anonymous>/, /^native /];
const FRAME_RE = /at .+?\((.+?):\d+:\d+\)|at (.+?):\d+:\d+/;

const errorCounter = getMeter().createCounter('app.exception', {
  description: 'Total application exceptions by fingerprint',
});

function extractFirstAppFrame(stack: string | undefined): string {
  if (!stack) return 'unknown';

  const lines = stack.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    if (SKIP_PATTERNS.some((p) => p.test(trimmed))) continue;

    const match = trimmed.match(FRAME_RE);
    const filePath = match?.[1] || match?.[2];
    if (filePath) {
      return filePath.replace(/:\d+:\d+$/, '');
    }
  }

  return 'unknown';
}

export function computeFingerprint(
  error: Error | string,
  errorType: string,
): { fingerprint: string; group: string } {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const frame = extractFirstAppFrame(stack);

  return {
    fingerprint: `${errorType}:${frame}`,
    group: message.length > 120 ? message.slice(0, 120) : message,
  };
}

export function recordError(
  error: Error | string,
  errorType: string,
  extraAttrs?: Record<string, string>,
): { fingerprint: string; group: string } {
  const { fingerprint, group } = computeFingerprint(error, errorType);

  errorCounter.add(1, {
    'error.fingerprint': fingerprint,
    'error.type': errorType,
    'error.severity': extraAttrs?.['error.severity'] || '5xx',
    'error.group': group,
    ...extraAttrs,
  });

  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute('error.fingerprint', fingerprint);
    span.setAttribute('error.group', group);
    const err = error instanceof Error ? error : new Error(String(error));
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  }

  return { fingerprint, group };
}

export function recordClientError(
  error: Error | string,
  errorType: string,
  extraAttrs?: Record<string, string>,
): { fingerprint: string; group: string } {
  const { fingerprint, group } = computeFingerprint(error, errorType);

  errorCounter.add(1, {
    'error.fingerprint': fingerprint,
    'error.type': errorType,
    'error.severity': '4xx',
    'error.group': group,
    ...extraAttrs,
  });

  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute('error.fingerprint', fingerprint);
    span.setAttribute('error.group', group);
  }

  return { fingerprint, group };
}
