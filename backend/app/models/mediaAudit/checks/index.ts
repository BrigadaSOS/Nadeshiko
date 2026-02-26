import type { DataSource } from 'typeorm';
import type { Client } from '@elastic/elasticsearch';

export interface ThresholdField {
  key: string;
  label: string;
  type: 'number' | 'boolean';
  default: number | boolean;
  min?: number;
  max?: number;
}

export interface CheckResult {
  targetType: 'MEDIA' | 'EPISODE';
  mediaId: number;
  episodeNumber?: number;
  data: Record<string, unknown>;
  description: string;
}

export interface CheckRunContext {
  threshold: Record<string, number | boolean>;
  category?: string;
  dataSource: DataSource;
  esClient?: Client;
}

export interface MediaAuditCheck {
  name: string;
  label: string;
  description: string;
  targetType: 'MEDIA' | 'EPISODE';
  thresholdSchema: ThresholdField[];
  run(ctx: CheckRunContext): Promise<CheckResult[]>;
}

import { lowSegmentMedia } from './lowSegmentMedia';
import { emptyEpisodes } from './emptyEpisodes';
import { missingEpisodes } from './missingEpisodes';
import { badSegmentRatio } from './badSegmentRatio';
import { mediaWithNoEpisodes } from './mediaWithNoEpisodes';
import { dbEsSyncIssues } from './dbEsSyncIssues';
import { highReportDensity } from './highReportDensity';

export const auditRegistry: MediaAuditCheck[] = [
  lowSegmentMedia,
  emptyEpisodes,
  missingEpisodes,
  badSegmentRatio,
  mediaWithNoEpisodes,
  dbEsSyncIssues,
  highReportDensity,
];
