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

export interface MediaReviewCheck {
  name: string;
  label: string;
  description: string;
  targetType: 'MEDIA' | 'EPISODE';
  thresholdSchema: ThresholdField[];
  run(ctx: CheckRunContext): Promise<CheckResult[]>;
}

import { lowSegmentMedia } from './checks/lowSegmentMedia';
import { emptyEpisodes } from './checks/emptyEpisodes';
import { missingEpisodes } from './checks/missingEpisodes';
import { badSegmentRatio } from './checks/badSegmentRatio';
import { mediaWithNoEpisodes } from './checks/mediaWithNoEpisodes';
import { missingTranslations } from './checks/missingTranslations';
import { dbEsSyncIssues } from './checks/dbEsSyncIssues';
import { highReportDensity } from './checks/highReportDensity';

export const checkRegistry: MediaReviewCheck[] = [
  lowSegmentMedia,
  emptyEpisodes,
  missingEpisodes,
  badSegmentRatio,
  mediaWithNoEpisodes,
  missingTranslations,
  dbEsSyncIssues,
  highReportDensity,
];
