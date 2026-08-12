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

    // A STATEMENT RATHER THAN THE QUERY BUILDER, and it has to be. This is an
    // atomic read-modify-write, and the builder cannot express one: TypeORM v1
    // removed `onConflict()`, and its replacement `orUpdate()` only names columns
    // to overwrite with the values from the INSERT. `orUpdate(['requestCount'])`
    // would therefore write `request_count = 1` on every collision -- turning a
    // counter into a flag, silently, with no type error and no failing insert.
    //
    // Doing it as a read-then-write instead would be worse: two callers in the
    // same period race and one increment is lost. One statement keeps the count
    // correct under concurrency, which is the whole point of the quota.
    //
    // The unqualified `"request_count"` on the right-hand side is the EXISTING
    // row, per Postgres' ON CONFLICT rules -- `excluded` would be the rejected
    // insert, i.e. the constant 1.
    const repository = AccountQuotaUsage.getRepository();
    const table = repository.metadata.tableName;

    await repository.query(
      `INSERT INTO "${table}" ("user_id", "period_yyyymm", "request_count")
       VALUES ($1, $2, 1)
       ON CONFLICT ("user_id", "period_yyyymm") DO UPDATE
          SET "request_count" = "${table}"."request_count" + 1,
              "updated_at" = CURRENT_TIMESTAMP`,
      [userId, periodYyyymm],
    );
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
