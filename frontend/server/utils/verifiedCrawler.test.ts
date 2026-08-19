import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('~~/server/utils/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import {
  claimedFamily,
  hostMatchesFamily,
  isVerifiedCrawler,
  normalizeIp,
  verifyAddress,
  _resetForTests,
  _setResolverForTests,
  type CrawlerResolver,
} from './verifiedCrawler';

const GOOGLEBOT_UA =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.137 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

/** A resolver that answers from fixed tables and counts what it was asked. */
function fakeResolver(
  ptr: Record<string, string[]>,
  forward: Record<string, string[]>,
): CrawlerResolver & { reverseCalls: number } {
  const spy = {
    reverseCalls: 0,
    reverse: async (ip: string) => {
      spy.reverseCalls += 1;
      return ptr[ip] ?? [];
    },
    forward: async (hostname: string) => forward[hostname] ?? [],
  };
  return spy;
}

/** The scheduled lookup is fire-and-forget, so tests wait for it to land. */
async function settled(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** The Googlebot family record, asserted rather than `!`-ed so a regression in
 *  `claimedFamily` fails here with a sentence instead of a null dereference. */
function googlebotFamily() {
  const family = claimedFamily(GOOGLEBOT_UA);
  if (!family) throw new Error('Googlebot UA should classify as a verifiable family');
  return family;
}

beforeEach(() => {
  _resetForTests();
  _setResolverForTests(null);
});

describe('claimedFamily', () => {
  it('recognises the crawlers we are willing to exempt', () => {
    expect(claimedFamily(GOOGLEBOT_UA)?.name).toBe('googlebot');
    expect(claimedFamily('Mozilla/5.0 (compatible; bingbot/2.0)')?.name).toBe('bingbot');
    expect(claimedFamily('Applebot/0.1')?.name).toBe('applebot');
  });

  it('does not recognise an ordinary browser, or nothing at all', () => {
    expect(claimedFamily(CHROME_UA)).toBeNull();
    expect(claimedFamily(undefined)).toBeNull();
    expect(claimedFamily('')).toBeNull();
  });

  it('does not recognise crawlers we deliberately left out', () => {
    expect(claimedFamily('Mozilla/5.0 (compatible; AhrefsBot/7.0)')).toBeNull();
    expect(claimedFamily('Mozilla/5.0 (compatible; YandexBot/3.0)')).toBeNull();
  });
});

describe('hostMatchesFamily', () => {
  const google = googlebotFamily();

  it('accepts a hostname under the operator domain', () => {
    expect(hostMatchesFamily('crawl-66-249-64-227.googlebot.com', google)).toBe(true);
    expect(hostMatchesFamily('rate-limited-proxy-66-249-64-1.google.com', google)).toBe(true);
  });

  it('accepts the bare operator domain and a trailing-dot PTR answer', () => {
    expect(hostMatchesFamily('googlebot.com', google)).toBe(true);
    expect(hostMatchesFamily('crawl-1.googlebot.com.', google)).toBe(true);
  });

  it('rejects a lookalike that merely ends with the same letters', () => {
    expect(hostMatchesFamily('evil-googlebot.com', google)).toBe(false);
    expect(hostMatchesFamily('googlebot.com.attacker.net', google)).toBe(false);
    expect(hostMatchesFamily('notgoogle.com', google)).toBe(false);
  });
});

describe('verifyAddress', () => {
  const google = googlebotFamily();

  it('confirms an address whose PTR resolves forward to itself', async () => {
    _setResolverForTests(
      fakeResolver(
        { '66.249.64.227': ['crawl-66-249-64-227.googlebot.com'] },
        { 'crawl-66-249-64-227.googlebot.com': ['66.249.64.227'] },
      ),
    );

    await expect(verifyAddress('66.249.64.227', google)).resolves.toBe(true);
  });

  it('rejects a forged PTR that does not resolve back', async () => {
    // Anyone controlling an address block can publish this PTR; only the
    // forward leg, served by Google, can refuse it.
    _setResolverForTests(
      fakeResolver({ '203.0.113.7': ['crawl-fake.googlebot.com'] }, { 'crawl-fake.googlebot.com': ['66.249.64.227'] }),
    );

    await expect(verifyAddress('203.0.113.7', google)).resolves.toBe(false);
  });

  it('rejects an address with no PTR under the operator domain', async () => {
    _setResolverForTests(fakeResolver({ '203.0.113.8': ['host.attacker.net'] }, {}));

    await expect(verifyAddress('203.0.113.8', google)).resolves.toBe(false);
  });

  it('matches an IPv4-mapped peer against the address DNS answers with', async () => {
    _setResolverForTests(
      fakeResolver(
        { '66.249.64.227': ['crawl-66-249-64-227.googlebot.com'] },
        { 'crawl-66-249-64-227.googlebot.com': ['66.249.64.227'] },
      ),
    );

    await expect(verifyAddress('::ffff:66.249.64.227', google)).resolves.toBe(true);
  });
});

describe('isVerifiedCrawler', () => {
  it('fails closed on the first request and passes once the lookup lands', async () => {
    _setResolverForTests(
      fakeResolver(
        { '66.249.64.227': ['crawl-66-249-64-227.googlebot.com'] },
        { 'crawl-66-249-64-227.googlebot.com': ['66.249.64.227'] },
      ),
    );

    // Cache miss: rate limited exactly as before, no waiting on a resolver.
    expect(isVerifiedCrawler('66.249.64.227', GOOGLEBOT_UA)).toBe(false);
    await settled();
    expect(isVerifiedCrawler('66.249.64.227', GOOGLEBOT_UA)).toBe(true);
  });

  it('keeps refusing an address that claims Googlebot but cannot prove it', async () => {
    _setResolverForTests(fakeResolver({ '203.0.113.9': ['vps.attacker.net'] }, {}));

    expect(isVerifiedCrawler('203.0.113.9', GOOGLEBOT_UA)).toBe(false);
    await settled();
    expect(isVerifiedCrawler('203.0.113.9', GOOGLEBOT_UA)).toBe(false);
  });

  it('refuses an address whose reverse lookup throws', async () => {
    // The production shape for a spoofer: the addresses running headless Chrome
    // against the site have no PTR at all, so `dns.reverse` rejects with
    // ENOTFOUND rather than answering an empty list.
    _setResolverForTests({
      reverse: async () => {
        throw Object.assign(new Error('getHostByAddr ENOTFOUND'), { code: 'ENOTFOUND' });
      },
      forward: async () => [],
    });

    expect(isVerifiedCrawler('20.127.214.166', GOOGLEBOT_UA)).toBe(false);
    await settled();
    expect(isVerifiedCrawler('20.127.214.166', GOOGLEBOT_UA)).toBe(false);
  });

  it('never touches DNS for an ordinary browser', async () => {
    const resolverSpy = fakeResolver({}, {});
    _setResolverForTests(resolverSpy);

    expect(isVerifiedCrawler('203.0.113.10', CHROME_UA)).toBe(false);
    await settled();
    expect(resolverSpy.reverseCalls).toBe(0);
  });

  it('does not verify one family using another family verdict for the same address', async () => {
    _setResolverForTests(
      fakeResolver(
        { '66.249.64.227': ['crawl-66-249-64-227.googlebot.com'] },
        { 'crawl-66-249-64-227.googlebot.com': ['66.249.64.227'] },
      ),
    );

    isVerifiedCrawler('66.249.64.227', GOOGLEBOT_UA);
    await settled();
    expect(isVerifiedCrawler('66.249.64.227', GOOGLEBOT_UA)).toBe(true);
    // Same address, different claim: the Googlebot proof says nothing about it.
    expect(isVerifiedCrawler('66.249.64.227', 'Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(false);
  });

  it('answers false when there is no address to check', () => {
    expect(isVerifiedCrawler(undefined, GOOGLEBOT_UA)).toBe(false);
    expect(isVerifiedCrawler('', GOOGLEBOT_UA)).toBe(false);
  });
});

describe('normalizeIp', () => {
  it('strips the IPv4-mapped IPv6 prefix and normalises case', () => {
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp(' 2001:DB8::1 ')).toBe('2001:db8::1');
  });
});
