const rateLimit = require('express-rate-limit');

export const searchFetchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 2000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    message: 'Too many requests. Please try again later.',
  },
});
