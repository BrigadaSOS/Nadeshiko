import { Entity, PrimaryColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Named tiers let one quota change apply to many accounts; `quotaOverride` remains the per-account escape hatch and
 * wins over the tier. */
@Entity('Tier')
export class Tier extends BaseEntity {
  /** Stable slug (`free`, `plus`, `pro`) -- referenced by `User.tierId`. */
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  @Column({ name: 'monthly_quota_limit', type: 'int' })
  monthlyQuotaLimit!: number;

  /** Stamp the burst allowance onto new keys; existing keys are not restamped when a tier changes, so live
   * integrations keep their limits. */
  @Column({ name: 'rate_limit_max', type: 'int', nullable: true })
  rateLimitMax!: number | null;

  @Column({ name: 'rate_limit_window_ms', type: 'int', nullable: true })
  rateLimitWindowMs!: number | null;

  /** Display order for the admin picker; the id is a slug, not a rank. */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}
