import { config } from '@config/config';
import { normalizeAddress } from './suppression';

/** The allowlist is per recipient, so one sweep can send a real test message while keeping every other recipient in
 * dry-run mode. */
export function lifecycleSendsAreLive(): boolean {
  return config.LIFECYCLE_EMAILS_ENABLED;
}

/** Parse the allowlist on each call because tests change configuration between cases; do not freeze the first answer
 * at module load. */
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

/** Anything not explicitly allowed is a dry run, not an error; it must not fail the sweep or consume a pg-boss
 * retry. */
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
