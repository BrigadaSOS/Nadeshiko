import { LAB_FEATURES_MAP } from '@app/config/labFeatures';
import type { User } from '@app/models/User';

export function isFeatureEnabledForUser(user: User, featureKey: string): boolean {
  const feature = LAB_FEATURES_MAP.get(featureKey);
  if (!feature || !feature.enabled) return false;
  if (feature.requiresRole && user.role !== feature.requiresRole) return false;
  return user.preferences?.labs?.[featureKey] === true;
}
