import type { LabIndex } from 'generated/routes/labs';
import { LAB_FEATURES } from '@app/config/labFeatures';

export const labIndex: LabIndex = async (_params, respond) => {
  const features = LAB_FEATURES.map((f) => ({
    key: f.key,
    name: f.name,
    description: f.description,
    enabled: f.enabled,
  }));

  return respond.with200().body(features);
};
