import type { t_Episode } from 'generated/models';
import type { Episode } from '@app/models';

export const toEpisodeDTO = (episode: Episode): t_Episode => ({
  mediaId: episode.mediaId,
  episodeNumber: episode.episodeNumber,
  anilistEpisodeId: episode.anilistEpisodeId,
  titleEn: episode.titleEn,
  titleRomaji: episode.titleRomaji,
  titleJa: episode.titleJa,
  description: episode.description,
  airedAt: episode.airedAt?.toISOString(),
  lengthSeconds: episode.lengthSeconds,
  thumbnailUrl: episode.thumbnailUrl,
  segmentCount: episode.segmentCount,
});

export const toEpisodeListDTO = (episodes: Episode[]): t_Episode[] => episodes.map(toEpisodeDTO);
