import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    jwt?: any;
    user?: any;
    apiKey?: string;
    apiKeyPermissions?: string[];
    auth?: {
      type: 'session' | 'dev-impersonation' | 'api-key-better-auth' | 'api-key-legacy';
      user_id: number;
    };
    accountQuota?: {
      periodYyyymm: number;
      quotaLimit: number;
      quotaUsed: number;
      quotaRemaining: number;
    };
    _accountQuotaApplied?: boolean;
  }
}
