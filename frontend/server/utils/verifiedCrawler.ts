import { promises as dns } from 'node:dns';
import { createLogger } from '~~/server/utils/logger';

const log = createLogger('verifiedCrawler');

/**
 * Whether a request is from a search crawler that has *proved* it is one, so the
 * per-IP HTML limiter can let it through.
 *
 * WHY THIS EXISTS. Googlebot met the HTML limiter 14,002 times in the week to
 * 2026-08-19 -- 4.5% of its requests, in bursts of 5,290 and 4,064 on single
 * days -- and 12,711 of those rejections were `/{locale}/sentence/<id>`, the
 * permalink space that is the site's entire long-tail surface. A crawler that is
 * handed sustained 429s reduces its crawl rate, so the limiter was quietly
 * trading away indexing of the corpus. `ipRateLimit.ts` already records an
 * earlier round of this ("Googlebot met it on 12.9% of its requests"); fixing
 * the worker-count divisor raised the ceiling but did not stop Google hitting
 * it, because Google crawls from a handful of addresses and the limit is per
 * address.
 *
 * WHY NOT THE USER-AGENT. Because it is the client's to choose. Exempting on a
 * User-Agent match would turn `Googlebot` into an off switch for the limiter,
 * available to anyone who types it -- the same class of mistake the backend
 * limiter documents rejecting for `CF-Connecting-IP`, and a far worse one here
 * because this limiter is the only ceiling on HTML renders. The User-Agent is
 * therefore treated as a *claim* that costs nothing to make, and the claim is
 * checked against DNS, which the claimant does not control.
 *
 * HOW THE PROOF WORKS. Forward-confirmed reverse DNS, the scheme Google, Bing
 * and Apple each document for exactly this purpose: reverse the address, require
 * the resulting hostname to sit under a domain only the operator can publish
 * under, then resolve that hostname forward again and require it to come back to
 * the address we started with. The reverse lookup alone is not enough -- PTR
 * records are set by whoever controls the address block, so anyone can point one
 * at `crawl-.googlebot.com`; only the forward leg, served by Google's own
 * nameservers, closes that.
 *
 * FAIL CLOSED, AND OFF THE HOT PATH. DNS is a network round trip and this sits
 * in front of every HTML render, so the answer is only ever read from cache: a
 * miss returns `false` -- the request is rate limited as it always was -- and
 * schedules the lookup for whoever comes next. Google crawls from a stable set
 * of addresses, so the cost is a handful of throttled requests once per address
 * per TTL, and never a request that waits on a resolver. Every failure mode --
 * timeout, SERVFAIL, no PTR, mismatch -- lands on "not verified", so the limiter
 * degrades to its previous behaviour rather than opening up.
 */

interface CrawlerFamily {
  /** For logs, and for keying the cache so two claims from one address cannot
   *  borrow each other's verdict. */
  readonly name: string;
  /** What the claim looks like in a User-Agent. */
  readonly pattern: RegExp;
  /** Domains the operator alone can publish under. Leading dot required, so
   *  `notgooglebot.com` cannot satisfy a `.googlebot.com` suffix test. */
  readonly suffixes: readonly string[];
}

/**
 * The crawlers worth exempting: the ones that send readers, and that publish a
 * documented verification scheme.
 *
 * Deliberately NOT here: AhrefsBot (16,109 requests on 2026-08-19, the largest
 * declared crawler on the site, and it sends nobody), Baidu and Yandex (not this
 * audience), and every AI crawler. None of them are blocked by their absence --
 * they simply keep the same per-IP budget as anyone else, which is the right
 * default for traffic whose crawl rate is not worth protecting. Adding a family
 * here is a decision to let it crawl as fast as it likes.
 */
const FAMILIES: readonly CrawlerFamily[] = [
  {
    name: 'googlebot',
    pattern: /googlebot|google-inspectiontool|storebot-google/i,
    suffixes: ['.googlebot.com', '.google.com'],
  },
  {
    name: 'bingbot',
    pattern: /bingbot|bingpreview/i,
    suffixes: ['.search.msn.com'],
  },
  {
    name: 'applebot',
    pattern: /applebot/i,
    suffixes: ['.applebot.apple.com'],
  },
];

/** Long enough that a stable crawler address is looked up rarely, short enough
 *  that an address Google hands back is not trusted for a working day. */
const VERIFIED_TTL_MS = 6 * 60 * 60 * 1000;
/** Short, because this is also what a transient resolver failure lands on. */
const REJECTED_TTL_MS = 15 * 60 * 1000;
/** A resolver that never answers must not pin an in-flight slot forever. */
const LOOKUP_TIMEOUT_MS = 2_000;
/** Bounds what a spoofer can make us remember: they choose the address, and so
 *  the key, but not how many we keep. */
const MAX_ENTRIES = 4_096;

interface Verdict {
  verified: boolean;
  expiresAt: number;
}

const cache = new Map<string, Verdict>();
const inFlight = new Set<string>();

/** DNS, injectable so the logic can be tested without a resolver. */
export interface CrawlerResolver {
  reverse(ip: string): Promise<string[]>;
  forward(hostname: string): Promise<string[]>;
}

const nodeResolver: CrawlerResolver = {
  reverse: (ip) => dns.reverse(ip),
  forward: async (hostname) => {
    // Both families, because a crawler reached over IPv6 confirms through AAAA.
    // `resolve*` queries the authoritative chain; `lookup` would consult the
    // host's own resolver order (and /etc/hosts), which is not what a proof of
    // ownership should read.
    const [v4, v6] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[]),
    ]);
    return [...v4, ...v6];
  },
};

let resolver: CrawlerResolver = nodeResolver;

/**
 * Strips the IPv4-mapped IPv6 prefix Node reports for v4 peers, so the address
 * compared against DNS is the one DNS will answer with.
 */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  return trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
}

/** Which family, if any, this User-Agent claims to be. Pure. */
export function claimedFamily(userAgent: string | undefined): CrawlerFamily | null {
  if (!userAgent) return null;
  return FAMILIES.find((family) => family.pattern.test(userAgent)) ?? null;
}

/**
 * Whether a hostname sits under one of the family's domains. Pure.
 *
 * Suffix match on a dot-prefixed domain, with the bare domain accepted too, so
 * `crawl-66-249-64-227.googlebot.com` passes and `evil-googlebot.com` does not.
 */
export function hostMatchesFamily(hostname: string, family: CrawlerFamily): boolean {
  // A PTR answer is conventionally returned with a trailing dot; strip it so the
  // suffix test does not silently fail on a resolver that includes it.
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return family.suffixes.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1));
}

/** Runs the full forward-confirmed lookup. Exported for tests. */
export async function verifyAddress(ip: string, family: CrawlerFamily): Promise<boolean> {
  const address = normalizeIp(ip);

  const hostnames = await resolver.reverse(address);
  const candidate = hostnames.find((hostname) => hostMatchesFamily(hostname, family));
  if (!candidate) return false;

  // The leg that matters: the PTR above is published by whoever holds the
  // address block, this one by whoever holds the domain.
  const forward = await resolver.forward(candidate);
  return forward.some((resolved) => normalizeIp(resolved) === address);
}

function remember(key: string, verified: boolean): void {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, verdict] of cache) {
      if (verdict.expiresAt <= now) cache.delete(entryKey);
    }
    // Still full: drop in insertion order, which is the closest thing to
    // "least recently learned" a plain Map gives us.
    while (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  cache.set(key, {
    verified,
    expiresAt: Date.now() + (verified ? VERIFIED_TTL_MS : REJECTED_TTL_MS),
  });
}

function scheduleVerification(key: string, ip: string, family: CrawlerFamily): void {
  if (inFlight.has(key)) return;
  inFlight.add(key);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('dns timeout')), LOOKUP_TIMEOUT_MS).unref?.(),
  );

  Promise.race([verifyAddress(ip, family), timeout])
    .then((verified) => {
      remember(key, verified);
      if (!verified) {
        // Someone is claiming to be a crawler and is not. Worth seeing: it is
        // the shape of a scraper that has read a blog post about bot exemptions.
        log.warn({ ip, family: family.name }, 'crawler claim failed verification');
      }
    })
    .catch((error) => {
      remember(key, false);
      log.debug({ ip, family: family.name, err: String(error) }, 'crawler verification error');
    })
    .finally(() => {
      inFlight.delete(key);
    });
}

/**
 * Whether this request may skip the per-IP limiter.
 *
 * Synchronous and cache-only by design -- see the note at the top of the file.
 * An unknown address answers `false` and is limited normally while the lookup
 * runs for the next one.
 */
export function isVerifiedCrawler(ip: string | undefined, userAgent: string | undefined): boolean {
  if (!ip) return false;

  const family = claimedFamily(userAgent);
  if (!family) return false;

  const key = `${family.name}|${normalizeIp(ip)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.verified;

  scheduleVerification(key, ip, family);
  return false;
}

// Test-only -- DO NOT call from prod code
export function _setResolverForTests(next: CrawlerResolver | null): void {
  resolver = next ?? nodeResolver;
}

// Test-only -- DO NOT call from prod code
export function _resetVerifiedCrawlerForTests(): void {
  cache.clear();
  inFlight.clear();
}
