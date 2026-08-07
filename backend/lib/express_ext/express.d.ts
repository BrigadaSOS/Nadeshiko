import 'express-serve-static-core';
import type { TrafficKind } from '@lib/traffic';
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
    accountQuota?: {
      periodYyyymm: number;
      quotaLimit: number;
      quotaUsed: number;
      quotaRemaining: number;
    };
    /** Raw request body captured by `rawBodySaver` for the pino serializer. */
    rawBody?: string;
    /** reader / bot / monitor, set by `trafficClassification`. */
    traffic?: TrafficKind;
    /** The crawler's name when `traffic` is "bot", e.g. "gptbot". */
    botFamily?: string;
  }

  interface Response {
    /** Response body captured by `responseBodyLogger` for the pino serializer. */
    responseBody?: unknown;
  }
}
