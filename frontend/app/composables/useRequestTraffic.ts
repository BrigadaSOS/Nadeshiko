import { resolveEventTraffic, type TrafficKind } from '#shared/utils/traffic';

/**
 * What kind of visitor this render is for, on the server.
 *
 * The classification already exists -- every SSR call carries it inward on
 * `x-nadeshiko-traffic` so the backend can attribute its work -- but only the
 * SDK factory was reading it. A page needs it too, because some of the work a
 * render does is worth doing for a reader and not for a crawler.
 *
 * `reader` on the client, always: there is no request to classify after
 * hydration, and a component that guards on this must not change its mind
 * between the server render and the first client one.
 */

/** The testable half: classification of an H3 event, with no Nuxt globals. */
export function trafficOfRender(event: Parameters<typeof resolveEventTraffic>[0]): TrafficKind {
  return resolveEventTraffic(event).traffic;
}

export function useRequestTraffic(): TrafficKind {
  if (!import.meta.server) return 'reader';
  return trafficOfRender(useRequestEvent());
}
