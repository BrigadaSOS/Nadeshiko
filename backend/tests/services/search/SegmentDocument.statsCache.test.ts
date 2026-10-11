import { describe, it, expect, afterEach } from 'vitest';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { Cache } from '@lib/cache';

/** Pin the search-stats cap independently: crawler queries can fill the cache and exhaust the heap if the cap
 * regresses. */
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
