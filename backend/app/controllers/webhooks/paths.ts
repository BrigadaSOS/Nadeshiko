/**
 * Webhook paths, in a module with no imports of its own.
 *
 * Kept apart from the controllers because `config/application.ts` needs the path
 * at middleware-mount time (the ZeptoMail body has to be read as text before the
 * JSON parser sees it) while `config/routes.ts` needs the handler. Importing the
 * controller from both puts `application.ts` and `routes.ts` in a cycle through
 * it, and the constant resolves as `undefined` on whichever side loads first --
 * which does not throw, it just mounts the middleware at a path nobody requests.
 */
export const WEBHOOK_ZEPTOMAIL_PATH = '/v1/webhooks/zeptomail';
