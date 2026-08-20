import { config } from '@config/config';
import { normalizeAddress } from './suppression';

/**
 * Whether lifecycle mail may actually leave the building, and for whom.
 *
 * THREE STATES, and the default is the safe one:
 *
 *   1. `LIFECYCLE_EMAILS_ENABLED=false` -- nothing sends. The sweep still runs
 *      and still logs what it would have done, which is the point: the candidate
 *      counts are readable from production before anybody commits to the copy.
 *   2. enabled, with `LIFECYCLE_EMAILS_ONLY_TO` set -- those addresses get real
 *      mail, everybody else stays a dry run. The staging post between "off" and
 *      "everyone", and the only way to see the message in a real client.
 *   3. enabled, no allowlist -- everybody.
 *
 * The allowlist is checked per RECIPIENT rather than as a global on/off, so a
 * single sweep can send to one address for real and dry-run the other six
 * hundred in the same pass. That is what makes state 2 a test of the real path
 * rather than a different path.
 */
export function lifecycleSendsAreLive(): boolean {
  return config.LIFECYCLE_EMAILS_ENABLED;
}

/**
 * Addresses allowed a real send, or null for "no restriction".
 *
 * Parsed on every call rather than cached at module load, because the tests set
 * the config value between cases and a cache would make the first one to run
 * decide the answer for all of them.
 */
function allowlist(): Set<string> | null {
  const raw = config.LIFECYCLE_EMAILS_ONLY_TO?.trim();
  if (!raw) return null;

  const addresses = raw
    .split(',')
    .map(normalizeAddress)
    .filter((address): address is string => Boolean(address));

  // A value that parses to nothing -- `LIFECYCLE_EMAILS_ONLY_TO=","` -- is a
  // mistake, and the safe reading of it is an empty allowlist (nobody), not an
  // absent one (everybody).
  return new Set(addresses);
}

/**
 * Whether this specific recipient gets a real send.
 *
 * Everything that is not a yes is a dry run, never an error: a lifecycle email
 * that does not go out is the intended state of this feature until somebody
 * decides otherwise, and it must not fail a nightly job or burn a pg-boss retry.
 */
export function mayReallySend(address: string): boolean {
  if (!lifecycleSendsAreLive()) return false;

  const allowed = allowlist();
  if (!allowed) return true;

  const normalized = normalizeAddress(address);
  return normalized !== null && allowed.has(normalized);
}

/** How the gate is set right now, for the one log line that says so at startup. */
export function describeLifecycleGate(): string {
  if (!lifecycleSendsAreLive()) {
    return 'DRY RUN -- lifecycle email is disabled, so the sweep will report what it would send and send nothing. Set LIFECYCLE_EMAILS_ENABLED=true to turn it on.';
  }

  const allowed = allowlist();
  if (!allowed) return 'LIVE -- lifecycle email is enabled for every recipient';

  return `LIVE for ${allowed.size} allowlisted address(es); everybody else is a dry run`;
}
