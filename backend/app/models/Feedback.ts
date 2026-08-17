import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';

/** Longer than anyone writes in a panel this size, short enough that a paste of
 *  a whole log file is rejected at the edge rather than stored. */
export const FEEDBACK_MAX_BODY = 4000;

/** Link-spam guard. Real feedback quotes a URL or two; it does not paste six. */
export const FEEDBACK_MAX_URLS = 5;

@Entity('Feedback')
@Index(['createdAt'])
export class Feedback extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'text' })
  body!: string;

  /** The reply address. Typed by anonymous senders, copied from the account for
   *  signed-in ones, so the mailer has one field to read either way. */
  @Column({ type: 'varchar', length: 320, nullable: true })
  email?: string | null;

  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId?: number | null;

  @ManyToOne('User', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  /** Path + query of the page they were on, same-origin only. `/search?q=…` is
   *  most of what makes a vague report reproducible. */
  @Column({ name: 'page_path', type: 'text', nullable: true })
  pagePath?: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  locale?: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  country?: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress?: string | null;

  @Column({ name: 'app_version', type: 'varchar', length: 32, nullable: true })
  appVersion?: string | null;

  /** Client-supplied, read off posthog-js at submit. Untrusted, so capped by the
   *  column as well as by the schema; blank wherever posthog is not loaded. */
  @Column({ name: 'posthog_session_id', type: 'varchar', length: 64, nullable: true })
  posthogSessionId?: string | null;

  @Column({ name: 'posthog_distinct_id', type: 'varchar', length: 128, nullable: true })
  posthogDistinctId?: string | null;

  /** Triage flag. A timestamp and not a boolean, so the queue also records when. */
  @Column({ name: 'handled_at', type: 'timestamptz', nullable: true })
  handledAt?: Date | null;
}
