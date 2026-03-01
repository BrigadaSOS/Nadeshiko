/**
 * Single source of truth for TypeORM entities, subscribers, and shared config.
 * Used by both the production DataSource and the test DataSource.
 */
import type { LoggerOptions } from 'typeorm';
import { isProdEnvironment } from '@config/environment';
import { config } from '@config/config';
import {
  User,
  AccountQuotaUsage,
  Media,
  MediaExternalId,
  Segment,
  Episode,
  ApiAuth,
  ApiAuthPermission,
  Character,
  Seiyuu,
  MediaCharacter,
  Collection,
  CollectionSegment,
  Series,
  SeriesMedia,
  Report,
  MediaAudit,
  MediaAuditRun,
  UserActivity,
  SegmentRevision,
  Experiment,
  ExperimentEnrollment,
  Announcement,
} from '@app/models';
import { SegmentSubscriber } from '@app/subscribers';

export const APP_ENTITIES = [
  User,
  AccountQuotaUsage,
  Media,
  MediaExternalId,
  Segment,
  Episode,
  ApiAuth,
  ApiAuthPermission,
  Character,
  Seiyuu,
  MediaCharacter,
  Collection,
  CollectionSegment,
  Series,
  SeriesMedia,
  Report,
  MediaAudit,
  MediaAuditRun,
  UserActivity,
  SegmentRevision,
  Experiment,
  ExperimentEnrollment,
  Announcement,
];

export const APP_SUBSCRIBERS = [SegmentSubscriber];

/**
 * Resolve TypeORM logging config from the DB_LOG_LEVEL env var.
 *
 * Accepts:
 *   - "true" / "false"        → boolean
 *   - "all"                   → "all"
 *   - "query,error,warn"      → ["query", "error", "warn"]
 *
 * When unset, defaults to enabled in dev/local and disabled in prod.
 */
export function getDbLogging(rawValue: string | undefined = config.DB_LOG_LEVEL): LoggerOptions {
  const raw = rawValue?.trim().toLowerCase();
  if (!raw) return !isProdEnvironment();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'all') return 'all';
  return raw.split(',').map((s) => s.trim()) as LoggerOptions;
}
