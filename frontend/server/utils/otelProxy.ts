const MAX_BODY_SIZE = 65536;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const MAX_ENTRIES = 10_000;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  if (rateLimitMap.size > MAX_ENTRIES) {
    for (const [key, entry] of rateLimitMap) {
      if (entry.resetAt < now) rateLimitMap.delete(key);
    }
  }

  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

const ALLOWED_ORIGINS = [
  'https://nadeshiko.co',
  'https://dev.nadeshiko.co',
];

export function createOtelProxy(signal: 'traces' | 'logs') {
  const resourceKey = signal === 'traces' ? 'resourceSpans' : 'resourceLogs';

  return defineEventHandler(async (event) => {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) {
      throw createError({ statusCode: 503, statusMessage: 'Telemetry not configured' });
    }

    const origin = getHeader(event, 'origin');
    if (origin && origin !== 'null') {
      const allowed =
        ALLOWED_ORIGINS.includes(origin) ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:');
      if (!allowed) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
      }
    }

    const contentType = getHeader(event, 'content-type') || '';
    if (!contentType.includes('application/json') && !contentType.includes('application/x-protobuf')) {
      throw createError({ statusCode: 415, statusMessage: 'Unsupported content type' });
    }

    const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown';
    if (!checkRateLimit(ip)) {
      throw createError({ statusCode: 429, statusMessage: 'Too many requests' });
    }

    const body = await readRawBody(event, false);
    if (!body || body.byteLength > MAX_BODY_SIZE) {
      throw createError({ statusCode: 413, statusMessage: 'Payload too large' });
    }

    let finalBody: BodyInit = body as unknown as BodyInit;

    if (contentType.includes('application/json')) {
      const geoAttrs: Array<{ key: string; value: { stringValue: string } }> = [];

      const country = getHeader(event, 'cf-ipcountry');
      const cfRay = getHeader(event, 'cf-ray');
      const edge = cfRay?.split('-').pop();

      if (country) geoAttrs.push({ key: 'client.geo.country', value: { stringValue: country } });
      if (edge) geoAttrs.push({ key: 'client.geo.edge', value: { stringValue: edge } });

      if (geoAttrs.length > 0) {
        try {
          const payload = JSON.parse(new TextDecoder().decode(body));
          for (const rs of payload[resourceKey] || []) {
            rs.resource ??= { attributes: [] };
            rs.resource.attributes ??= [];
            rs.resource.attributes.push(...geoAttrs);
          }
          finalBody = JSON.stringify(payload);
        } catch {
          // If parsing fails, forward the original body unchanged
        }
      }
    }

    const collectorUrl = `${endpoint.replace(/\/$/, '')}/v1/${signal}`;

    const response = await fetch(collectorUrl, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: finalBody,
    });

    setResponseStatus(event, response.status);
    return '';
  });
}
