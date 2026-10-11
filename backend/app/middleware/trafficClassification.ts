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

/** Classify once before rate limiting so logs, metrics, spans, and 429s agree about traffic type. */

const meter = getMeter();

// Keep traffic/method/status labels bounded; the separate histogram answers latency, while this counter answers crawler
// share.
const requestCount = meter.createCounter('http.server.requests', {
  description: 'HTTP server requests by traffic type',
  unit: '{request}',
});

// Put crawler family on its own metric; combining it with method and status would create unnecessary cardinality.
const botRequestCount = meter.createCounter('http.server.bot_requests', {
  description: 'HTTP server requests by crawler family',
  unit: '{request}',
});

/** Allow only known family names from the shared frontend list, preventing a header from becoming a cardinality
 * bomb. */
const SAFE_FAMILY = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export interface RequestTraffic {
  traffic: TrafficKind;
  family: string | null;
}

/** For trusted frontend requests, prefer the frontend’s visitor classification because SSR does not forward the
 * visitor User-Agent. */
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
