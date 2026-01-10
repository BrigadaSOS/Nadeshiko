import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    jwt?: any;
    user?: any;
    apiKey?: string;
  }
}
