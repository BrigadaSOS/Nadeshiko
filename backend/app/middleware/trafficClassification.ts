import type { Request, Response, NextFunction } from 'express';
import { trace } from '@opentelemetry/api';
import {
  BOT_FAMILY_ATTRIBUTE,
  BOT_FAMILY_HEADER,
  TRAFFIC_ATTRIBUTE,
  TRAFFIC_HEADER,
  botFamily,
  classifyTraffic,
  parseTrafficHeader,
  trafficAttributes,
  type TrafficKind,
} from '@lib/traffic';
import { getMeter } from '@config/telemetry';
import { isTrustedInternalCaller } from '@lib/internalProxy';

/**
 * Labels every request as reader / bot / monitor traffic, once, as early as
 * possible, so the access log, the metrics, the span and any error raised
 * downstream all agree about who was on the other end.
 *
 * Mounted before the rate limiter (config/application.ts): a 429 is exactly the
 * kind of event worth splitting by traffic type, and by then the request has
 * already been decided.
 */

const meter = getMeter();

// Bounded by construction: 3 traffic values x the HTTP methods we route x 5
// status classes. Deliberately separate from the auto-instrumented
// `http.server.request.duration` histogram, which cannot carry a custom
// attribute — dividing bot by total here is what answers "how much of this is
// crawlers", and comparing it against the histogram answers "and is it slow".
const requestCount = meter.createCounter('http.server.requests', {
  description: 'HTTP server requests by traffic type',
  unit: '{request}',
});

// The crawler's name, on a counter of its own rather than as a fourth
// attribute on the one above: ~40 families cross-multiplied by method and
// status would be a few thousand series to answer a question ("which crawler")
// that never needs the other dimensions.
const botRequestCount = meter.createCounter('http.server.bot_requests', {
  description: 'HTTP server requests by crawler family',
  unit: '{request}',
});

/** Family names we are willing to put on a metric. The frontend derives the
 *  value from its copy of the same list (see lib/traffic.ts), so this only
 *  guards against a future caller turning the header into a cardinality bomb. */
const SAFE_FAMILY = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export interface RequestTraffic {
  traffic: TrafficKind;
  family: string | null;
}

/**
 * Who this request is from.
 *
 * The frontend's own classification wins when it is present AND the caller is
 * one of our own (internal-proxy secret or SERVICE key), because the frontend
 * saw the visitor and we may not: SSR fetches a page's data over the internal
 * network without the visitor's User-Agent attached, so a crawl of /search
 * would otherwise arrive here as anonymous reader load. Everything else is
 * classified from the User-Agent it presented.
 */
export function resolveTraffic(req: Request): RequestTraffic {
  if (isTrustedInternalCaller(req)) {
    const forwarded = parseTrafficHeader(req.get(TRAFFIC_HEADER));
    if (forwarded) {
      const forwardedFamily = (req.get(BOT_FAMILY_HEADER) ?? '').toLowerCase();
      return {
        traffic: forwarded,
        family: SAFE_FAMILY.test(forwardedFamily) ? forwardedFamily : null,
      };
    }
  }

  const userAgent = req.get('user-agent');
  return { traffic: classifyTraffic(userAgent), family: botFamily(userAgent) };
}

/** The attribute bag for this request, for metrics and spans. */
export function trafficAttributesFor(req: Request): Record<string, string> {
  return trafficAttributes(req.traffic ?? 'reader', req.botFamily);
}

function statusClass(statusCode: number): string {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  if (statusCode >= 200) return '2xx';
  return '1xx';
}

export function trafficClassification(req: Request, res: Response, next: NextFunction): void {
  const { traffic, family } = resolveTraffic(req);
  req.traffic = traffic;
  req.botFamily = family ?? undefined;

  // On the span too, so a slow trace can be traced back to a crawler without
  // leaving the trace view — and so tail-based sampling could act on it later.
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute(TRAFFIC_ATTRIBUTE, traffic);
    if (family) span.setAttribute(BOT_FAMILY_ATTRIBUTE, family);
  }

  res.on('finish', () => {
    requestCount.add(1, {
      [TRAFFIC_ATTRIBUTE]: traffic,
      'http.request.method': req.method,
      'http.status_class': statusClass(res.statusCode),
    });
    if (family) {
      botRequestCount.add(1, { [BOT_FAMILY_ATTRIBUTE]: family });
    }
  });

  next();
}
