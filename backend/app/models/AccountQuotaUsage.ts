import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './User';

export interface AccountQuotaSnapshot {
  periodYyyymm: number;
  quotaLimit: number;
  quotaUsed: number;
  quotaRemaining: number;
}

@Entity('AccountQuotaUsage')
@Index(['userId', 'periodYyyymm'], { unique: true })
export class AccountQuotaUsage extends BaseEntity {
  static readonly DEFAULT_QUOTA_LIMIT = 5000;

  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'period_yyyymm', type: 'int' })
  periodYyyymm!: number;

  @Column({ name: 'request_count', type: 'int', default: 0 })
  requestCount!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  static getCurrentPeriodYyyymm(date = new Date()): number {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    return year * 100 + month;
  }

  static getQuotaWindow(periodYyyymm = AccountQuotaUsage.getCurrentPeriodYyyymm()): {
    periodStart: string;
    periodEnd: string;
  } {
    const year = Math.floor(periodYyyymm / 100);
    const month = periodYyyymm % 100;
    const periodStartDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const periodEndDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    return {
      periodStart: periodStartDate.toISOString(),
      periodEnd: periodEndDate.toISOString(),
    };
  }

  static async incrementForUser(userId: number): Promise<void> {
    const periodYyyymm = AccountQuotaUsage.getCurrentPeriodYyyymm();
    await AccountQuotaUsage.createQueryBuilder()
      .insert()
      .values({ userId, periodYyyymm, requestCount: 1 })
      .onConflict(`("user_id", "period_yyyymm") DO UPDATE SET
        "request_count" = "AccountQuotaUsage"."request_count" + 1,
        "updated_at" = CURRENT_TIMESTAMP`)
      .execute();
  }

  static async getForUser(userId: number, quotaLimit?: number): Promise<AccountQuotaSnapshot> {
    const periodYyyymm = AccountQuotaUsage.getCurrentPeriodYyyymm();
    const effectiveLimit =
      quotaLimit != null && Number.isFinite(quotaLimit) ? quotaLimit : AccountQuotaUsage.DEFAULT_QUOTA_LIMIT;

    const usage = await AccountQuotaUsage.findOne({
      where: { userId, periodYyyymm },
    });

    const quotaUsed = usage?.requestCount ?? 0;

    return {
      periodYyyymm,
      quotaLimit: effectiveLimit,
      quotaUsed,
      quotaRemaining: Math.max(effectiveLimit - quotaUsed, 0),
    };
  }
}
