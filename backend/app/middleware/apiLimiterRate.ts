import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const ORIGIN_SAFETY_WINDOW_MS = parsePositiveInteger(process.env.ORIGIN_SAFETY_WINDOW_MS, 60 * 1000);
const ORIGIN_SAFETY_LIMIT = parsePositiveInteger(process.env.ORIGIN_SAFETY_LIMIT, 2000);

export const originSafetyLimiter = rateLimit({
  windowMs: ORIGIN_SAFETY_WINDOW_MS,
  limit: ORIGIN_SAFETY_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  message: { message: 'Too many requests. Please try again later.' },
});
