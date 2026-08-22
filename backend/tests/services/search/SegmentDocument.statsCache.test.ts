import { describe, it, expect, afterEach } from 'vitest';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { Cache } from '@lib/cache';

/**
 * A guard on ONE NUMBER: the entry cap of the search-stats namespace.
 *
 * It reads like a triviality and it is not. At `createCacheNamespace`'s default
 * of 10,000 entries this namespace took the production backend down every ~3
 * hours (Nadeshiko#522): the key is the query text plus every filter, so a
 * crawler walking search URLs mints a new entry per request, and the value is a
 * per-media and per-episode aggregation over the whole corpus. Ten thousand of
 * those is ~500MB, against a V8 heap limit of 864MB that Node derives from the
 * container's memory cap.
 *
 * Nothing else fails when the cap goes back to the default -- not a test, not a
 * request, not an alert until the process is already dying -- so the number
 * needs its own assertion.
 */
const NS = SegmentDocument.SEARCH_STATS_CACHE;
const TTL = 60_000;

afterEach(() => {
  Cache.invalidate(NS);
});

describe('the search-stats cache cap', () => {
  it('holds far fewer entries than the 10,000 default', () => {
    for (let i = 0; i < 400; i++) {
      Cache.set(NS, `key-${i}`, { media: [], categories: [], includes: { media: {} } }, TTL);
    }

    let survivors = 0;
    for (let i = 0; i < 400; i++) {
      if (Cache.get(NS, `key-${i}`) !== null) survivors++;
    }

    expect(survivors).toBeLessThanOrEqual(250);
    expect(survivors).toBeGreaterThan(0);
  });

  it('evicts the oldest query and keeps the newest, so a crawler cannot pin the heap', () => {
    for (let i = 0; i < 400; i++) {
      Cache.set(NS, `key-${i}`, { media: [] }, TTL);
    }

    expect(Cache.get(NS, 'key-0')).toBeNull();
    expect(Cache.get(NS, 'key-399')).not.toBeNull();
  });
});
