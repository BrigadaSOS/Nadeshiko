export interface QueryMediaInfoResponse {
  readonly stats: MediaInfoStats;
  readonly results: Map<number, MediaInfoData>;
}

export interface MediaInfoStats {
  readonly totalAnimes: number;
  readonly totalSegments: number;
  readonly fullTotalAnimes: number;
  readonly fullTotalSegments: number;
}

export interface MediaInfoData {
  mediaId: number;
  category: string; // String enum: "ANIME" or "JDRAMA"
  categoryName: string; // Same as category - for backwards compatibility
  createdAt: string;
  updatedAt?: number;
  romajiName: string;
  englishName: string;
  japaneseName: string;
  airingFormat: string;
  airingStatus: string;
  startDate: string;
  endDate?: string;
  folderMediaName: string;
  genres: string[];
  cover: string;
  banner: string;
  version: string;
  numSegments: number;
  numSeasons: number;
  numEpisodes: number;
}
