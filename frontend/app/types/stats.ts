export interface CoverageTier {
  tier: number;
  covered: number;
  total: number;
  percentage: number;
}

export interface TranslationStats {
  total: number;
  enHuman: number;
  enMachine: number;
  esHuman: number;
  esMachine: number;
}

export interface StatsOverviewResponse {
  totalSegments: number;
  totalEpisodes: number;
  totalMedia: number;
  totalFrequencyWords: number;
  dialogueHours: number;
  tiers: CoverageTier[];
  lastUpdated: string | null;
  translations: TranslationStats;
}

export interface UpdateResult {
  wordsChecked: number;
  newlyCovered: number;
  totalCovered: number;
  percentage: number;
}

export interface WordEntry {
  rank: number;
  word: string;
  matchCount: number;
}

export interface TierStats {
  total: number;
  covered: number;
  uncovered: number;
}

export interface WordsResponse {
  words: WordEntry[];
  nextCursor: number | null;
  tierStats: TierStats;
}
