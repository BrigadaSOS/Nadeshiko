import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A named quota level, so a bump is a row reference rather than an edit to the
 * account it applies to.
 *
 * Before this, `User.monthly_quota_limit` was the whole model: 613 accounts on
 * 5000 and one on 10000, that one set by hand against production after a
 * support email. Nothing recorded WHY it differed, so the number could not be
 * revised as a group -- raising "everyone paying" meant finding them first, and
 * the only thing distinguishing them was the number itself.
 *
 * The scalar column survives as `User.quotaOverride`, which is the same escape
 * hatch it always was, now named as one: it means "this account, for a reason
 * that is not a tier", and it wins over the tier when set.
 */
@Entity('Tier')
export class Tier extends BaseEntity {
  /** Stable slug (`free`, `plus`, `pro`) -- referenced by `User.tierId`. */
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  @Column({ name: 'monthly_quota_limit', type: 'int' })
  monthlyQuotaLimit!: number;

  /**
   * Per-key burst allowance, stamped onto keys at creation. Null inherits the
   * process-wide `API_KEY_RATE_LIMIT_MAX`, which is what every key issued
   * before this table used and what `free` deliberately keeps using: a tier
   * that only changes the monthly number should not silently also change the
   * burst.
   *
   * Existing keys are NOT restamped when a tier changes. better-auth stores the
   * allowance on the key row, and rewriting live keys from a tier edit would
   * change limits under running integrations with nothing in the response to
   * say why. A new key picks up the new tier.
   */
  @Column({ name: 'rate_limit_max', type: 'int', nullable: true })
  rateLimitMax!: number | null;

  @Column({ name: 'rate_limit_window_ms', type: 'int', nullable: true })
  rateLimitWindowMs!: number | null;

  /** Display order for the admin picker; the id is a slug, not a rank. */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}
