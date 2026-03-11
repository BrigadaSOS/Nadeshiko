export const ES_SYNC_CREATE_QUEUE = 'es-sync-create';
export const ES_SYNC_UPDATE_QUEUE = 'es-sync-update';
export const ES_SYNC_DELETE_QUEUE = 'es-sync-delete';
export const EMAIL_SEND_QUEUE = 'email-send';
export const ACTIVITY_RETENTION_QUEUE = 'activity-retention-cleanup';

export const ES_SYNC_QUEUES = [ES_SYNC_CREATE_QUEUE, ES_SYNC_UPDATE_QUEUE, ES_SYNC_DELETE_QUEUE] as const;

export const ALL_QUEUES = [
  ES_SYNC_CREATE_QUEUE,
  ES_SYNC_UPDATE_QUEUE,
  ES_SYNC_DELETE_QUEUE,
  EMAIL_SEND_QUEUE,
  ACTIVITY_RETENTION_QUEUE,
] as const;

export type EsSyncQueueName = (typeof ES_SYNC_QUEUES)[number];
