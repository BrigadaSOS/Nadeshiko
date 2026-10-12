import { resolveEventTraffic, type TrafficKind } from '#shared/utils/traffic';

/**
 * Expose SSR traffic classification so pages can distinguish reader work from crawler work.
 * Client calls always return reader.
 */

/** The testable half: classification of an H3 event, with no Nuxt globals. */
export function trafficOfRender(event: Parameters<typeof resolveEventTraffic>[0]): TrafficKind {
  return resolveEventTraffic(event).traffic;
}

export function useRequestTraffic(): TrafficKind {
  if (!import.meta.server) return 'reader';
  return trafficOfRender(useRequestEvent());
}
