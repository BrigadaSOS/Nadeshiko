import type { t_Episode } from 'generated/models';
import type { Episode } from '@app/models';

export const toEpisodeDTO = (episode: Episode, mediaPublicId: string): t_Episode => ({
  mediaPublicId,
  episodeNumber: episode.episodeNumber,
  titleEn: episode.titleEn ?? null,
  titleRomaji: episode.titleRomaji ?? null,
  titleJa: episode.titleJa ?? null,
  description: episode.description ?? null,
  airedAt: episode.airedAt instanceof Date ? episode.airedAt.toISOString() : (episode.airedAt ?? null),
  lengthSeconds: episode.lengthSeconds ?? null,
  thumbnailUrl: episode.thumbnailUrl ?? null,
  segmentCount: episode.segmentCount,
});

export const toEpisodeListDTO = (episodes: Episode[], mediaPublicId: string): t_Episode[] =>
  episodes.map((e) => toEpisodeDTO(e, mediaPublicId));
