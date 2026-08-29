/**
 * Traffic classification for the edge, re-exported so `#shared/utils/traffic`
 * keeps meaning what it always meant to its call sites, plus the H3 helpers that
 * are this runtime's alone.
 *
 * The rules themselves live in `@brigadasos/nadeshiko-shared/traffic`, which the
 * backend reads too. They used to be a byte-identical copy of that file kept in
 * step by hand and policed by a drift test; see the header there for why one
 * copy was worth the workspace package.
 *
 * Still in `shared/` rather than `server/` because the SSR SDK factory -- also
 * bundled into the client build -- stamps the answer onto its internal calls.
 */
export * from '@brigadasos/nadeshiko-shared/traffic';

import {
  botFamily,
  classifyTraffic,
  BOT_FAMILY_HEADER,
  TRAFFIC_HEADER,
  type TrafficKind,
} from '@brigadasos/nadeshiko-shared/traffic';

// --- Frontend-only helpers. Not shared: the backend reads Express requests,
// this side reads H3 events. ---

export interface EventTraffic {
  traffic: TrafficKind;
  family: string | null;
}

const READER: EventTraffic = { traffic: 'reader', family: null };

// Structural, rather than importing H3Event: this module is bundled into the
// client build too, where h3's types are not worth pulling along.
interface TrafficEventLike {
  context?: Record<string, unknown>;
  node?: { req?: { headers?: Record<string, string | string[] | undefined> } };
}

function headerValue(event: TrafficEventLike, name: string): string | undefined {
  const raw = event.node?.req?.headers?.[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Classifies the event, memoising the answer on `event.context.traffic`, so
 *  every emitter on one request agrees and only the first pays for it. */
export function resolveEventTraffic(event: TrafficEventLike | null | undefined): EventTraffic {
  if (!event) return READER;

  const cached = event.context?.traffic as EventTraffic | undefined;
  if (cached) return cached;

  const userAgent = headerValue(event, 'user-agent');
  const resolved: EventTraffic = { traffic: classifyTraffic(userAgent), family: botFamily(userAgent) };
  if (event.context) event.context.traffic = resolved;

  return resolved;
}

/** The headers that carry this visitor's classification to the backend. */
export function trafficHeaders(event: TrafficEventLike | null | undefined): Record<string, string> {
  const { traffic, family } = resolveEventTraffic(event);
  const headers: Record<string, string> = { [TRAFFIC_HEADER]: traffic };
  if (family) headers[BOT_FAMILY_HEADER] = family;
  return headers;
}
