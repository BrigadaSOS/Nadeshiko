import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One delivery event from ZeptoMail: the forensic log behind every suppression.
 *
 * Never edited after insert. When somebody says they never got the email, this
 * is the table that answers whether we sent it, whether it bounced, and what the
 * receiving server actually said.
 */
@Entity('EmailEvent')
export class EmailEvent extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Index()
  @Column({ type: 'varchar', length: 320 })
  address!: string;

  /**
   * One of `EMAIL_EVENTS`, or the provider's own name for something we did not
   * anticipate. Deliberately not a database enum: losing an event because it had
   * a name we had not seen is worse than holding one we cannot act on.
   */
  @Column({ type: 'varchar', length: 32 })
  event!: string;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  /** The receiving server's own words, e.g. `550 5.1.1 User unknown`. */
  @Column({ name: 'diagnostic_message', type: 'text', nullable: true })
  diagnosticMessage?: string | null;

  @Column({ name: 'email_reference', type: 'varchar', length: 128, nullable: true })
  emailReference?: string | null;

  /**
   * What we set as `X-TM-CLIENT-REF` when we sent the message, handed back to us
   * here. Over SMTP it is the only thing tying a bounce to which mail we sent and
   * why: without it, a failed message is anonymous by the time it fails.
   */
  @Column({ name: 'client_reference', type: 'varchar', length: 128, nullable: true })
  clientReference?: string | null;

  /** The provider's delivery id. Half of the idempotency key; see the migration. */
  @Column({ name: 'webhook_request_id', type: 'varchar', length: 128, nullable: true })
  webhookRequestId?: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  /**
   * The verified payload, whole. ZeptoMail's published documentation carries no
   * complete sample and wraps several fields in single-element arrays, so our
   * parsing is a best reading rather than a spec. This column is what tells us
   * whether that reading was right once real events start arriving.
   */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;
}

export const EMAIL_EVENTS = ['hard_bounce', 'soft_bounce', 'complaint', 'open', 'click'] as const;

export type EmailEventName = (typeof EMAIL_EVENTS)[number];
