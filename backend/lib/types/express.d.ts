import 'express-serve-static-core';
import type { UserRoleType } from '@app/entities';

declare module 'express-serve-static-core' {
  interface Request {
    jwt?: {
      user_id: number;
      role: UserRoleType;
    };
    user?: any;
    apiKey?: string;
    apiKeyPermissions?: string[];
    auth?: {
      type: 'session' | 'api-key-better-auth' | 'api-key-legacy';
      user_id: number;
      apiKeyId?: string;
      apiKeyKind?: 'service' | 'user';
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
