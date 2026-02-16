import type { UserLabsIndex } from 'generated/routes/user';
import { LAB_FEATURES } from '@app/config/labFeatures';

export const userLabsIndex: UserLabsIndex = async (_params, respond, req) => {
  const user = (req as any).user;

  const features = LAB_FEATURES.filter((f) => !f.requiresRole || user?.role === f.requiresRole).map((f) => ({
    key: f.key,
    name: f.name,
    description: f.description,
    enabled: f.enabled,
    userEnabled: user?.preferences?.labs?.[f.key] ?? false,
  }));

  return respond.with200().body(features);
};
