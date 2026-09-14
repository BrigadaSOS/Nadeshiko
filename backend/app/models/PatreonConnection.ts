import { Column, Entity, Index, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import type { User } from './User';
import { BaseEntity } from './base.entity';

@Entity('PatreonConnection')
export class PatreonConnection extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Index({ unique: true })
  @Column({ name: 'patreon_user_id', type: 'varchar' })
  patreonUserId!: string;

  @Column({ name: 'access_token_ciphertext', type: 'text' })
  accessTokenCiphertext!: string;

  @Column({ name: 'refresh_token_ciphertext', type: 'text' })
  refreshTokenCiphertext!: string;

  @Column({ name: 'access_token_expires_at', type: 'timestamptz' })
  accessTokenExpiresAt!: Date;

  @Column({ name: 'full_name', type: 'varchar', nullable: true })
  fullName?: string | null;

  @Column({ name: 'campaign_id', type: 'varchar', nullable: true })
  campaignId?: string | null;

  @Column({ name: 'member_id', type: 'varchar', nullable: true })
  memberId?: string | null;

  @Column({ name: 'patron_status', type: 'varchar', nullable: true })
  patronStatus?: string | null;

  @Column({ name: 'entitled_amount_cents', type: 'int', default: 0 })
  entitledAmountCents!: number;

  @Column({ name: 'membership_checked_at', type: 'timestamptz' })
  membershipCheckedAt!: Date;

  @OneToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  get active(): boolean {
    return this.patronStatus === 'active_patron' && this.entitledAmountCents > 0;
  }

  toJSON() {
    return {
      linked: true,
      fullName: this.fullName ?? null,
      active: this.active,
      patronStatus: this.patronStatus ?? null,
      entitledAmountCents: this.entitledAmountCents,
      membershipCheckedAt: this.membershipCheckedAt.toISOString(),
      linkedAt: this.createdAt.toISOString(),
    };
  }
}
