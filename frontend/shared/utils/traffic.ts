// Keep the shared import path stable while re-exporting common rules and adding frontend H3 helpers.
// This stays client-safe because the SSR SDK factory is bundled on both sides.
export * from '@brigadasos/nadeshiko-shared/traffic';

import {
  botFamily,
  classifyTraffic,
  BOT_FAMILY_HEADER,
  TRAFFIC_HEADER,
  type TrafficKind,
} from '@brigadasos/nadeshiko-shared/traffic';

export interface EventTraffic {
  traffic: TrafficKind;
  family: string | null;
}

const READER: EventTraffic = { traffic: 'reader', family: null };

// Structural event type avoids coupling the client bundle to H3Event.
interface TrafficEventLike {
  context?: Record<string, unknown>;
  node?: { req?: { headers?: Record<string, string | string[] | undefined> } };
}

function headerValue(event: TrafficEventLike, name: string): string | undefined {
  const raw = event.node?.req?.headers?.[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

// Memoize per request so logs, metrics and internal calls agree on the classification.
export function resolveEventTraffic(event: TrafficEventLike | null | undefined): EventTraffic {
  if (!event) return READER;

  const cached = event.context?.traffic as EventTraffic | undefined;
  if (cached) return cached;

  const userAgent = headerValue(event, 'user-agent');
  const resolved: EventTraffic = { traffic: classifyTraffic(userAgent), family: botFamily(userAgent) };
  if (event.context) event.context.traffic = resolved;

  return resolved;
}

export function trafficHeaders(event: TrafficEventLike | null | undefined): Record<string, string> {
  const { traffic, family } = resolveEventTraffic(event);
  const headers: Record<string, string> = { [TRAFFIC_HEADER]: traffic };
  if (family) headers[BOT_FAMILY_HEADER] = family;
  return headers;
}
