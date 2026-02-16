import type { UserRoleType } from '@app/models/User';

export interface LabFeatureDefinition {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  requiresRole?: UserRoleType;
}

export const LAB_FEATURES: LabFeatureDefinition[] = [
  {
    key: 'activity-tracking',
    name: 'Activity Tracking',
    description: 'Track your searches, exports, and listening history.',
    enabled: true,
  },
];

export const LAB_FEATURES_MAP = new Map(LAB_FEATURES.map((f) => [f.key, f]));
