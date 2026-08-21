export const ES_SYNC_CREATE_QUEUE = 'es-sync-create';
export const ES_SYNC_UPDATE_QUEUE = 'es-sync-update';
export const ES_SYNC_DELETE_QUEUE = 'es-sync-delete';
export const EMAIL_SEND_QUEUE = 'email-send';
export const EMAIL_LIFECYCLE_QUEUE = 'email-lifecycle-sweep';
export const ACTIVITY_RETENTION_QUEUE = 'activity-retention-cleanup';
export const AFFINITY_RETENTION_QUEUE = 'affinity-retention-cleanup';
export const TOKEN_PARSE_QUEUE = 'segment-token-parse';
export const TOKEN_SWEEP_QUEUE = 'segment-token-sweep';

const ES_SYNC_QUEUES = [ES_SYNC_CREATE_QUEUE, ES_SYNC_UPDATE_QUEUE, ES_SYNC_DELETE_QUEUE] as const;

export const ALL_QUEUES = [
  ES_SYNC_CREATE_QUEUE,
  ES_SYNC_UPDATE_QUEUE,
  ES_SYNC_DELETE_QUEUE,
  EMAIL_SEND_QUEUE,
  EMAIL_LIFECYCLE_QUEUE,
  ACTIVITY_RETENTION_QUEUE,
  AFFINITY_RETENTION_QUEUE,
  TOKEN_PARSE_QUEUE,
  TOKEN_SWEEP_QUEUE,
] as const;

export type EsSyncQueueName = (typeof ES_SYNC_QUEUES)[number];
