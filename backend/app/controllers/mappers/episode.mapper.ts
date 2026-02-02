import type { t_Episode } from 'generated/models';
import type { Episode } from '@app/entities';

export const toEpisodeDTO = (episode: Episode): t_Episode => ({
  mediaId: episode.mediaId,
  episodeNumber: episode.episodeNumber,
  anilistEpisodeId: episode.anilistEpisodeId,
  titleEnglish: episode.titleEnglish,
  titleRomaji: episode.titleRomaji,
  titleJapanese: episode.titleJapanese,
  description: episode.description,
  airedAt: episode.airedAt?.toISOString(),
  lengthSeconds: episode.lengthSeconds,
  thumbnailUrl: episode.thumbnailUrl,
  numSegments: episode.numSegments,
});

export const toEpisodeListDTO = (episodes: Episode[]): t_Episode[] => episodes.map(toEpisodeDTO);
