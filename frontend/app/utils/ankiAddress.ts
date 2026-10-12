/**
 * Classify AnkiConnect address shape for failure analytics without returning or sending the reader's private
 * hostname or LAN address. Any string, including empty input, has a result.
 */

/**
 * Keep IPv4 loopback, localhost names and IPv6 loopback separate because origin/CSP behavior differs. Other
 * valid URLs are remote; invalid URLs are unparseable.
 */
export const ANKI_ADDRESS_KINDS = ['loopback_v4', 'localhost', 'loopback_v6', 'remote', 'unparseable'] as const;

export type AnkiAddressKind = (typeof ANKI_ADDRESS_KINDS)[number];

/**
 * Hostnames the browser resolves to this machine.
 *
 * `localhost` matches its subdomains too (`foo.localhost`), which RFC 6761
 * reserves and browsers resolve to loopback. Not a security boundary -- CSP
 * decides that -- so erring towards calling something local is harmless here.
 */
const isLocalhostName = (hostname: string): boolean => hostname === 'localhost' || hostname.endsWith('.localhost');

/**
 * The whole of `127.0.0.0/8` is loopback, not just `127.0.0.1`.
 *
 * Matched on the first octet, because a reader running more than one Anki does
 * sometimes use `127.0.0.2` and it is as local as the canonical one.
 */
const isLoopbackV4 = (hostname: string): boolean => /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);

/**
 * IPv6 loopback, in the bracketed form a URL carries it in.
 *
 * `URL.hostname` keeps the brackets, and `::1` has longer spellings that are
 * all the same address, so this normalises rather than comparing to one string.
 */
const isLoopbackV6 = (hostname: string): boolean => {
  const inner = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (!inner.includes(':')) return false;
  // `0:0:0:0:0:0:0:1` and `::1` and `::0001` are one address. Strip the zero
  // groups and see whether a lone `1` is what is left.
  return inner
    .split(':')
    .filter((group) => group !== '')
    .every((group) => /^0*1?$/.test(group))
    ? /(^|:)0*1$/.test(inner)
    : false;
};

/** Classifies an AnkiConnect server address. Never throws, never returns the input. */
export function classifyAnkiAddress(address: string): AnkiAddressKind {
  let hostname: string;
  try {
    hostname = new URL(address).hostname.toLowerCase();
  } catch {
    return 'unparseable';
  }

  if (isLoopbackV4(hostname)) return 'loopback_v4';
  if (isLocalhostName(hostname)) return 'localhost';
  if (isLoopbackV6(hostname)) return 'loopback_v6';
  return 'remote';
}
