import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Keep delivery events immutable; they are the forensic record behind suppression and delivery investigations. */
@Entity('EmailEvent')
export class EmailEvent extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Index()
  @Column({ type: 'varchar', length: 320 })
  address!: string;

  /** Store unknown provider event names instead of using a database enum; losing an event is worse than retaining
   * one we cannot act on. */
  @Column({ type: 'varchar', length: 32 })
  event!: string;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  /** The receiving server's own words, e.g. `550 5.1.1 User unknown`. */
  @Column({ name: 'diagnostic_message', type: 'text', nullable: true })
  diagnosticMessage?: string | null;

  @Column({ name: 'email_reference', type: 'varchar', length: 128, nullable: true })
  emailReference?: string | null;

  /** Persist the provider client reference so a bounce remains tied to the message kind and purpose that produced
   * it. */
  @Column({ name: 'client_reference', type: 'varchar', length: 128, nullable: true })
  clientReference?: string | null;

  /** The provider's delivery id. Half of the idempotency key; see the migration. */
  @Column({ name: 'webhook_request_id', type: 'varchar', length: 128, nullable: true })
  webhookRequestId?: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  /** Retain the verified payload because provider examples are incomplete and parsing real events may reveal a
   * different shape. */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;
}

export const EMAIL_EVENTS = ['hard_bounce', 'soft_bounce', 'complaint', 'open', 'click'] as const;

export type EmailEventName = (typeof EMAIL_EVENTS)[number];
