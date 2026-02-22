import 'express-serve-static-core';
import type { User } from '@app/models';
import type { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    auth?: {
      type: AuthType;
      apiKey?: {
        id?: string;
        kind?: ApiKeyKind;
        permissions: ApiPermission[];
      };
    };
    // Set by rateLimitApiQuota middleware after auth
    accountQuota?: {
      periodYyyymm: number;
      quotaLimit: number;
      quotaUsed: number;
      quotaRemaining: number;
    };
  }
}
