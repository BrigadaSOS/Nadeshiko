import { instrumentElasticsearchClient } from '@app/middleware/esInstrumentation';
import { client as esClient } from '@config/elasticsearch';
import type { RuntimeInitializer } from './types';

export const telemetryInitializer: RuntimeInitializer = {
  name: 'telemetry',
  initialize: () => {
    instrumentElasticsearchClient(esClient);
  },
};
