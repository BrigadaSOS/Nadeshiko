import { Request, Response } from 'express';

/**
 * Verify callback for express.json() and express.urlencoded() to capture raw request bodies for logging via pino.
 * Stores the raw body on req.rawBody for the pino serializer to access.
 *
 * This is used as the `verify` option in body-parser middleware, which calls it with:
 * - req: the request object
 * - res: the response object
 * - buf: the raw body buffer
 * - encoding: the encoding of the buffer
 *
 * The verify callback is invoked BEFORE the body is parsed, allowing us to capture
 * the raw body without interfering with the parsing process.
 *
 * @see https://expressjs.com/en/4x/api.html#req.body
 */
export const rawBodySaver = (req: Request, _res: Response, buf: Buffer, _encoding: string) => {
  // Store the raw body as a string for logging
  (req as any).rawBody = buf.toString('utf8');
};
