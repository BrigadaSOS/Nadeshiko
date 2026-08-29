/**
 * Describes the SHAPE of an AnkiConnect server address, without carrying the
 * address itself.
 *
 * `stores/anki.ts` files `anki_connect_request_failed` when a request does not
 * land, and until now that event said only which action was attempted and which
 * of the failure reasons applied. It could not say the one thing that separates
 * a reader we can help from one we cannot: whether they were pointing at their
 * own machine or across a network. So the Android numbers -- 1 reader exporting
 * successfully against 11 failing in the days to 2026-08-29, where Windows was
 * 41 against 9 -- had no explanation available, only guesses, and a guess about
 * that got as far as being written into `nuxt.config.ts` before it was checked
 * and turned out to be wrong.
 *
 * THE ADDRESS ITSELF IS NEVER SENT, and this exists so that stays true while the
 * question still gets answered. `activeProfile.serverAddress` is typed by the
 * reader and can hold a private hostname or a LAN layout, which is the kind of
 * thing commit 989b7c28a took out of the analytics on purpose. A fixed set of
 * shapes carries what a fix would turn on and nothing that describes a person.
 *
 * Pure and total: any string is classifiable, including the empty one.
 */

/**
 * - `loopback_v4` -- `127.0.0.0/8`. The default, and what a working desktop
 *   setup almost always looks like.
 * - `localhost` -- the name rather than the number. Equivalent in practice, but
 *   worth separating: it is a different CSP origin and resolves through the
 *   host's own rules, so it can fail where the literal does not.
 * - `loopback_v6` -- `[::1]`. Correct, increasingly common on v6-first machines,
 *   and refused by our policy until 2026-08-29.
 * - `remote` -- anything else that parses. Anki on another machine or phone.
 *   `connect-src` cannot express these, so they are refused before the network,
 *   and they are the population this whole distinction exists to size.
 * - `unparseable` -- not a URL. A reader who typed a bare host or a typo, which
 *   fails for a reason no server-side change will fix.
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
