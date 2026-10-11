/** Keep webhook paths import-free: application middleware and route handlers both need them, and importing a
 * controller would create a cycle. */
export const WEBHOOK_ZEPTOMAIL_PATH = '/v1/webhooks/zeptomail';
