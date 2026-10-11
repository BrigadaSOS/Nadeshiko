import { Request, Response } from 'express';
import { MAX_LOGGED_BODY_BYTES, oversizedBodyPlaceholder } from '@config/log';

/** Capture raw bodies in the parser’s `verify` callback before parsing; pino reads `req.rawBody`.
 * @see https://expressjs.com/en/4x/api.html#req.body */
export const rawBodySaver = (req: Request, _res: Response, buf: Buffer, _encoding: string) => {
  // Only keep what the logger will actually emit. The body limit is 10mb, and
  // this copy would otherwise be retained for the life of the request.
  if (buf.length > MAX_LOGGED_BODY_BYTES) {
    req.rawBody = oversizedBodyPlaceholder(buf.length);
    return;
  }

  req.rawBody = buf.toString('utf8');
};
