import type { AdminHealthShow } from 'generated/routes/admin';
import { checkElasticsearch, checkDatabase } from '@app/services/systemHealth';

const API_VERSION = '1.4.0';

export const adminHealthShow: AdminHealthShow = async (_params, respond) => {
  const [esHealth, dbHealth] = await Promise.all([checkElasticsearch(), checkDatabase()]);

  const status = esHealth.status === 'connected' && dbHealth.status === 'connected' ? 'healthy' : 'degraded';

  return respond.with200().body({
    status,
    app: { version: API_VERSION },
    elasticsearch: esHealth,
    database: dbHealth,
  });
};
