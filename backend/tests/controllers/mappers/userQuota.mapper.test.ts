import { describe, it, expect } from 'bun:test';
import { toUserQuotaDTO } from '@app/controllers/mappers/userQuota.mapper';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';

describe('userQuota.mapper', () => {
  it('maps quota snapshot with computed quota window', () => {
    const snapshot = {
      periodYyyymm: 202501,
      quotaLimit: 2500,
      quotaUsed: 250,
      quotaRemaining: 2250,
    };

    const expectedWindow = AccountQuotaUsage.getQuotaWindow(202501);
    const dto = toUserQuotaDTO(snapshot);

    expect(dto).toEqual({
      quotaUsed: 250,
      quotaLimit: 2500,
      quotaRemaining: 2250,
      periodYyyymm: 202501,
      periodStart: expectedWindow.periodStart,
      periodEnd: expectedWindow.periodEnd,
    });
  });
});
