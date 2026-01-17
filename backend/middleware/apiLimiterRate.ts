import rateLimit from 'express-rate-limit';

export const searchFetchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 2000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    message: 'Too many requests. Please try again later.',
  },
});

export const perEndpointLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Unique limit per IP + endpoint path
    return req.ip + ':' + req.path;
  },
  message: { message: 'Too many requests. Please try again later.' },
});
