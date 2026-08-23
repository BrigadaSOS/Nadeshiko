import { Entity, PrimaryColumn, Column, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tier } from './Tier';
import type { AccountQuotaUsage } from './AccountQuotaUsage';
import type { CategoryType } from './Media';

export enum UserRoleType {
  ADMIN = 'ADMIN',
  MOD = 'MOD',
  USER = 'USER',
  PATREON = 'PATREON',
}

interface AnkiProfile {
  id: string;
  name: string;
  deck?: string | null;
  model?: string | null;
  fields?: { key: string; value: string }[];
  key?: string | null;
  serverAddress: string;
}

export interface HiddenMediaItem {
  mediaPublicId: string;
}

export interface FavoriteMediaItem {
  mediaPublicId: string;
  /**
   * Set by the server, and the one thing about a starred title that is not
   * derivable from the catalogue -- which is why it survived the slimming that
   * took the names out of both lists.
   */
  favoritedAt: string;
}

export interface UserPreferences {
  /** Dictionary translation languages, in the order a reader wants to see them. */
  translationLanguages?: Array<'EN' | 'ES'>;
  searchHistory?: { enabled: boolean };
  /**
   * Governs the monthly per-title tally behind familiar-media sorting. Separate
   * from `searchHistory` on purpose: that one governs the activity log, this one
   * an aggregate count, and a reader may want one without the other.
   */
  familiarMedia?: { enabled: boolean };
  /**
   * Whether we may send this account the lifecycle mail -- the day-7 note, the
   * feedback ask, the monthly recap. Absent means yes: these are service
   * messages under the privacy policy's "updates or informative communications
   * related to the functionalities and services you use", so the default is on
   * and the reader turns it off.
   *
   * NOT a gate on transactional mail. A magic link, an address verification and
   * a bounce are the account working, not news about it, and honouring this flag
   * for them would let somebody lock themselves out of sign-in by clicking
   * unsubscribe in a recap.
   */
  productEmails?: {
    /**
     * The master switch, and the only one `List-Unsubscribe` touches.
     *
     * RFC 8058 one-click is POSTed by Gmail or Outlook with no person present,
     * and what it promises is "stop sending me this". A header that turned off
     * one category would not be that, so it sets this and this alone.
     */
    enabled: boolean;
    /**
     * The categories below are the finer grain, and ABSENT MEANS FOLLOW
     * `enabled` -- never a fresh yes.
     *
     * That distinction is the whole migration hazard. Treat a missing key as
     * consent and every reader who has already unsubscribed gets quietly
     * re-subscribed the day a new category ships, into mail they never saw and
     * never agreed to. That is how an opt-out becomes a spam report.
     */
    /** The monthly digest of their own activity. Recurring, indefinitely. */
    recap?: boolean;
    /** Occasional one-off questions: the day-7 ask, the win-back note. */
    checkins?: boolean;
    /** Releases and new features, including any request for support that rides in one. */
    updates?: boolean;
  };
  ankiProfiles?: AnkiProfile[];
  /**
   * The titles the reader hid, as ids and nothing else.
   *
   * Entries used to carry `nameEn`, `nameJa` and `nameRomaji` too. Nothing read
   * those names -- both list endpoints resolve them from `Media`, the search
   * filter and the hidden-result notice need only ids -- but they rode this blob
   * into `get-session` and from there into the `__NUXT_DATA__` of every page the
   * reader loads. A spelled-out entry costs ~141 bytes against the 34 an id-only
   * one costs, so hiding 200 of the ~320 titles carried ~21KB of duplicated
   * catalogue on every single render, growing with engagement.
   *
   * Still an object rather than a bare id string, which would have saved another
   * 19 bytes an entry, because kamal runs the old containers alongside the new
   * ones across a deploy and stale browser tabs outlive both. Old code reaches
   * for `item.mediaPublicId` and old response validation demands an object, so a
   * bare string would empty a reader's hidden list mid-deploy -- handing them
   * back the search results they deliberately hid -- and 500 every
   * `GET`/`PATCH /v1/user/preferences` an old container served. The names were
   * always optional in that schema; the wrapper is what has to stay.
   *
   * `normalizeMediaPreferences` still reads bare strings, so this can become one
   * in a later release once nothing old is left to read it.
   */
  hiddenMedia?: HiddenMediaItem[];
  /** Same slimming as `hiddenMedia`; see `FavoriteMediaItem` for why this one kept a field. */
  favoriteMedia?: FavoriteMediaItem[];
  hiddenCategories?: CategoryType[];
  /** `ALL` (and unset) means every visible category; see `UserPreferences.yaml`. */
  defaultSearchCategory?: CategoryType | 'ALL';
}

@Entity('User')
@Index(['email'])
export class User extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ type: 'varchar' })
  username!: string;

  @Column({ type: 'varchar', unique: true })
  email!: string;

  @Column({ type: 'varchar', nullable: true })
  image?: string;

  @Column({ name: 'modified_at', type: 'timestamp', nullable: true })
  modifiedAt?: Date;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ name: 'role', type: 'enum', enum: UserRoleType, default: UserRoleType.USER })
  role!: UserRoleType;

  /**
   * Cloudflare's two-letter country for the request that opened this account.
   *
   * Written once, at creation, and never updated -- where somebody signs in
   * from later is `session.country`, which is a different question. Null on
   * every account created before this was recorded, and on any created without
   * a Cloudflare hop (a seed, a script, local development), so absence means
   * "not recorded" rather than "unknown country".
   */
  @Column({ name: 'signup_country', type: 'varchar', length: 2, nullable: true })
  signupCountry?: string | null;

  /**
   * Roughly when this account was last used, and from where.
   *
   * Accurate to about a week, not to the minute: it moves on session creation
   * and on session refresh, and better-auth only refreshes past its seven-day
   * `updateAge`. Impersonated sessions do not move it. `lastSeenCountry` can
   * lag `lastSeenAt`, because a request that carried no country leaves the
   * previous one standing rather than nulling it -- see the migration.
   */
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt?: Date | null;

  @Column({ name: 'last_seen_country', type: 'varchar', length: 2, nullable: true })
  lastSeenCountry?: string | null;

  /**
   * The quota level this account sits on. Resolved through `resolveQuotaLimit`
   * rather than read directly -- a null tier (or one pointing at a row that has
   * since been deleted) has to fall back rather than fail a request.
   */
  @Column({ name: 'tier_id', type: 'text', nullable: true, default: 'free' })
  tierId!: string | null;

  /**
   * Per-account escape hatch, above whatever the tier says. Set for the case a
   * tier does not describe -- a one-off grant, a partner, an account being
   * unblocked mid-month -- and left null otherwise.
   */
  @Column({ name: 'quota_override', type: 'int', nullable: true })
  quotaOverride!: number | null;

  /**
   * @deprecated Read `resolveQuotaLimit(user)` instead, which applies the
   * override-then-tier order. Kept as a column because 614 rows carry the value
   * that was in force before tiers existed, and dropping it would rewrite their
   * limits in a migration rather than on a decision.
   */
  @Column({ name: 'monthly_quota_limit', type: 'int', default: 5000 })
  monthlyQuotaLimit!: number;

  @Column({ type: 'jsonb', default: '{}' })
  preferences!: UserPreferences;

  // Relations
  @OneToMany('AccountQuotaUsage', 'user')
  accountQuotaUsages?: AccountQuotaUsage[];

  @ManyToOne(() => Tier, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tier_id' })
  tier?: Tier | null;
}
