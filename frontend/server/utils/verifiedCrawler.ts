import { promises as dns } from 'node:dns';
import { createLogger } from '~~/server/utils/logger';

const log = createLogger('verifiedCrawler');

// Treat User-Agent as a claim, never proof. Require operator-domain reverse DNS and forward confirmation
// because address owners can forge PTRs. Read only cached verdicts on the render path: misses and DNS failures
// fail closed while background verification prepares later requests.

interface CrawlerFamily {
  // Key by family and address so one crawler claim cannot borrow another's proof.
  readonly name: string;

  readonly pattern: RegExp;
  // Dot-prefixed operator domains reject lookalikes such as notgooglebot.com.
  readonly suffixes: readonly string[];
}

// Only crawler families with a useful indexing role and documented verification bypass the normal per-IP budget.
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

// Refresh stable-address proofs before a released address remains trusted for a full day.
const VERIFIED_TTL_MS = 6 * 60 * 60 * 1000;
// Retry transient DNS failures sooner than verified verdicts expire.
const REJECTED_TTL_MS = 15 * 60 * 1000;
/** A resolver that never answers must not pin an in-flight slot forever. */
const LOOKUP_TIMEOUT_MS = 2_000;
// Bound cache growth from spoofed claims.
const MAX_ENTRIES = 4_096;

interface Verdict {
  verified: boolean;
  expiresAt: number;
}

const cache = new Map<string, Verdict>();
const inFlight = new Set<string>();

export interface CrawlerResolver {
  reverse(ip: string): Promise<string[]>;
  forward(hostname: string): Promise<string[]>;
}

const nodeResolver: CrawlerResolver = {
  reverse: (ip) => dns.reverse(ip),
  forward: async (hostname) => {
    // Confirm IPv4 and IPv6 through DNS resolve, not lookup: /etc/hosts is not proof of domain ownership.
    const [v4, v6] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[]),
    ]);
    return [...v4, ...v6];
  },
};

let resolver: CrawlerResolver = nodeResolver;

// Normalize mapped IPv4 addresses to the representation DNS returns.
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  return trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
}

export function claimedFamily(userAgent: string | undefined): CrawlerFamily | null {
  if (!userAgent) return null;
  return FAMILIES.find((family) => family.pattern.test(userAgent)) ?? null;
}

// Accept the bare operator domain or its dot-delimited subdomains, never suffix lookalikes.
export function hostMatchesFamily(hostname: string, family: CrawlerFamily): boolean {
  // Strip the conventional PTR trailing dot before suffix matching.
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return family.suffixes.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1));
}

export async function verifyAddress(ip: string, family: CrawlerFamily): Promise<boolean> {
  const address = normalizeIp(ip);

  const hostnames = await resolver.reverse(address);
  const candidate = hostnames.find((hostname) => hostMatchesFamily(hostname, family));
  if (!candidate) return false;

  // PTR is controlled by the address owner; forward DNS by the domain owner.
  const forward = await resolver.forward(candidate);
  return forward.some((resolved) => normalizeIp(resolved) === address);
}

function remember(key: string, verified: boolean): void {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, verdict] of cache) {
      if (verdict.expiresAt <= now) cache.delete(entryKey);
    }
    // Evict oldest-learned entries in insertion order.
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

// Cache-only and synchronous: unknown addresses remain rate-limited while verification runs.
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
