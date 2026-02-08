import cors, { CorsOptions } from 'cors';

const allowedOrigins = new Set(
  (process.env.ALLOWED_WEBSITE_URLS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const corsOptions: CorsOptions = {
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['X-Requested-With', 'content-type', 'traceparent', 'tracestate', 'Authorization'],
  optionsSuccessStatus: 204,
  origin: (origin, callback) => {
    // Requests without Origin are non-browser/server-to-server and do not require CORS.
    if (!origin) {
      callback(null, true);
      return;
    }

    callback(null, allowedOrigins.has(origin));
  },
};

export const corsMiddleware = cors(corsOptions);
