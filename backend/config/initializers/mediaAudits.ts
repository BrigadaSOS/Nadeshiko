import { seedAuditConfigs } from '@app/models/mediaAudit/runner';
import type { RuntimeInitializer } from './types';

export const mediaAuditsInitializer: RuntimeInitializer = {
  name: 'mediaAudits',
  initialize: async () => {
    await seedAuditConfigs();
  },
};
