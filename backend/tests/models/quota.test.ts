import { describe, it, expect } from 'vitest';
import { resolveQuotaLimit } from '@app/models/quota';
import type { Tier } from '@app/models';

const tier = (monthlyQuotaLimit: number): Tier => ({ id: 'plus', monthlyQuotaLimit }) as Tier;

const account = (overrides: Partial<Parameters<typeof resolveQuotaLimit>[0]> = {}) => ({
  id: 328,
  tierId: 'plus' as string | null,
  quotaOverride: null as number | null,
  monthlyQuotaLimit: 5000,
  ...overrides,
});

describe('resolveQuotaLimit', () => {
  it('prefers an explicit override over everything', () => {
    expect(resolveQuotaLimit(account({ quotaOverride: 50_000, tier: tier(25_000) }))).toEqual({
      limit: 50_000,
      source: 'override',
      tierId: 'plus',
    });
  });

  it('reads the tier when there is no override', () => {
    expect(resolveQuotaLimit(account({ tier: tier(25_000) }))).toEqual({
      limit: 25_000,
      source: 'tier',
      tierId: 'plus',
    });
  });

  // The one account production had off the default is migrated to an override
  // holding its old number, so 0 has to survive the resolution intact rather
  // than being read as "unset" by a truthiness check somewhere.
  it('treats a zero override as a real limit, not as absent', () => {
    expect(resolveQuotaLimit(account({ quotaOverride: 0, tier: tier(25_000) })).limit).toBe(0);
  });

  /**
   * The failure that has to stay quiet in the request path and loud in the log:
   * a tier row deleted out from under an account. Falling back to the number the
   * account already had is the only answer that neither fails their requests nor
   * silently promotes them.
   */
  it('falls back to the stored column when the tier row is gone', () => {
    expect(resolveQuotaLimit(account({ tier: null, monthlyQuotaLimit: 10_000 }))).toEqual({
      limit: 10_000,
      source: 'legacy_column',
      tierId: 'plus',
    });
  });

  it('falls back for an account on no tier at all', () => {
    expect(resolveQuotaLimit(account({ tierId: null, tier: null, monthlyQuotaLimit: 7000 }))).toEqual({
      limit: 7000,
      source: 'legacy_column',
      tierId: null,
    });
  });

  // A caller that fetched the user without joining the relation. Distinguished
  // from "the row is missing" so the log says which of the two happened -- one
  // is a bug in a query, the other is a bug in the data.
  it('reports an unloaded relation as the stored column, not as a missing tier', () => {
    const resolved = resolveQuotaLimit(account({ monthlyQuotaLimit: 5000 }));
    expect(resolved).toEqual({ limit: 5000, source: 'legacy_column', tierId: 'plus' });
  });

  it('lands on the built-in default when even the column is unusable', () => {
    expect(resolveQuotaLimit(account({ tier: null, monthlyQuotaLimit: NaN })).source).toBe('default');
  });
});
