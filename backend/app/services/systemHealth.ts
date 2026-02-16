import { client as esClient } from '@app/services/elasticsearch';
import { AppDataSource } from '@config/database';
import { config } from '@config/config';
import elasticsearchSchema from 'config/elasticsearch-schema.json';

const INDEX_NAME = config.ELASTICSEARCH_INDEX || elasticsearchSchema.index;

export async function checkElasticsearch() {
  try {
    const [info, health, count] = await Promise.all([
      esClient.info(),
      esClient.cluster.health(),
      esClient.count({ index: INDEX_NAME }),
    ]);

    return {
      status: 'connected' as const,
      version: info.version.number,
      clusterName: health.cluster_name,
      clusterStatus: health.status,
      indexName: INDEX_NAME,
      documentCount: count.count,
    };
  } catch {
    return {
      status: 'disconnected' as const,
      version: null,
      clusterName: null,
      clusterStatus: null,
      indexName: null,
      documentCount: null,
    };
  }
}

export async function checkDatabase() {
  try {
    const result = await AppDataSource.query('SELECT version()');
    const fullVersion: string = result[0]?.version ?? '';
    const version = fullVersion.split(' ').slice(0, 2).join(' ');

    return {
      status: 'connected' as const,
      version,
    };
  } catch {
    return {
      status: 'disconnected' as const,
      version: null,
    };
  }
}
