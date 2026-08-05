import { seedAuditConfigs } from '@app/services/mediaAudit/runner';
import type { RuntimeInitializer } from './types';

export const mediaAuditsInitializer: RuntimeInitializer = {
  name: 'mediaAudits',
  initialize: async () => {
    await seedAuditConfigs();
  },
};
