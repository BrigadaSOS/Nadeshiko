import type { UserRoleType } from '@app/models/User';

export interface LabFeatureDefinition {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  requiresRole?: UserRoleType;
}

export const LAB_FEATURES: LabFeatureDefinition[] = [];

export const LAB_FEATURES_MAP = new Map(LAB_FEATURES.map((f) => [f.key, f]));
