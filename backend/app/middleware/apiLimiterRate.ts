import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '@lib/config';

export const originSafetyLimiter = rateLimit({
  windowMs: config.ORIGIN_SAFETY_WINDOW_MS,
  limit: config.ORIGIN_SAFETY_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  message: { message: 'Too many requests. Please try again later.' },
});
