import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * An address we will not write to again, and why.
 *
 * A row rather than a flag on `User`, because most of what bounces is not a user
 * yet: a magic link to a typo'd address is refused before an account exists. The
 * address is the subject of this record, not the account.
 */
@Entity('EmailSuppression')
export class EmailSuppression extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320 })
  address!: string;

  @Column({ type: 'varchar', length: 32 })
  cause!: SuppressionCause;

  /** The provider's own words, kept so a lift decision has something to read. */
  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ name: 'suppressed_at', type: 'timestamptz' })
  suppressedAt!: Date;
}

/**
 * `manual` is somebody adding one by hand. `repeated_soft_bounce` is a mailbox
 * that was full or a server that was busy often enough that we stop believing it
 * is temporary.
 */
export const SUPPRESSION_CAUSES = ['hard_bounce', 'complaint', 'repeated_soft_bounce', 'manual'] as const;

export type SuppressionCause = (typeof SUPPRESSION_CAUSES)[number];

/**
 * A complaint is the one cause nothing lifts automatically: somebody pressed the
 * button that tells their provider we are spam, and sending again is how a
 * single complaint becomes a blocked domain.
 */
export function isPermanentCause(cause: SuppressionCause): boolean {
  return cause === 'complaint';
}
