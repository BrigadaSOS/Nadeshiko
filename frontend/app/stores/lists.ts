import type { SearchResult } from '@/stores/search';

export type ListType = 'SERIES' | 'CUSTOM' | 'SEGMENT';
export type ListVisibility = 'PUBLIC' | 'PRIVATE';

export type ListDTO = {
  id: number;
  name: string;
  type: ListType;
  userId: number;
  visibility: ListVisibility;
};

export type ListWithMedia = ListDTO & {
  media: Array<{
    position: number;
    media: {
      id: number;
      nameJa: string;
      nameRomaji: string;
      nameEn: string;
      coverUrl: string;
      bannerUrl: string;
      category: string;
      segmentCount: number;
      episodeCount: number;
    };
  }>;
};

export type ListSegmentEntry = {
  position: number;
  note: string | null;
  result: SearchResult;
};

export type ListWithSegments = ListDTO & {
  segments: ListSegmentEntry[];
  totalCount: number;
};

export const useListsStore = defineStore('lists', {
  state: () => ({
    publicLists: [] as ListDTO[],
    userLists: [] as ListDTO[],
    currentList: null as ListWithMedia | null,
    currentSegmentList: null as ListWithSegments | null,
    userSegmentListsCache: new Map<string, Set<number>>(), // listId -> set of segmentUuid hashes
  }),

  actions: {
    async fetchPublicLists(type?: ListType): Promise<ListDTO[]> {
      const params: Record<string, string> = { visibility: 'public' };
      if (type) params.type = type;

      const lists = await $fetch<ListDTO[]>('/api/lists', { params });
      this.publicLists = lists;
      return lists;
    },

    async fetchUserLists(): Promise<ListDTO[]> {
      const lists = await $fetch<ListDTO[]>('/api/lists', {
        params: { visibility: 'private' },
      });
      this.userLists = lists;
      return lists;
    },

    async fetchList(id: number): Promise<ListWithMedia> {
      const list = await $fetch<ListWithMedia>(`/api/lists/${id}`);
      this.currentList = list;
      return list;
    },

    async createList(name: string, type: ListType, visibility: ListVisibility): Promise<ListDTO> {
      return await $fetch<ListDTO>('/api/lists', {
        method: 'POST',
        body: { name, type, visibility },
      });
    },

    async updateList(id: number, data: { name?: string; visibility?: ListVisibility }): Promise<ListDTO> {
      return await $fetch<ListDTO>(`/api/lists/${id}`, {
        method: 'PATCH',
        body: data,
      });
    },

    async deleteList(id: number): Promise<void> {
      await $fetch(`/api/lists/${id}`, { method: 'DELETE' });
      this.userLists = this.userLists.filter((l) => l.id !== id);
    },

    async addMediaToList(listId: number, mediaId: number, position: number): Promise<void> {
      await $fetch(`/api/lists/${listId}/items`, {
        method: 'POST',
        body: { mediaId, position },
      });
    },

    async removeMediaFromList(listId: number, mediaId: number): Promise<void> {
      await $fetch(`/api/lists/${listId}/items/${mediaId}`, { method: 'DELETE' });
    },

    async fetchListSegments(listId: number, page = 1, limit = 20): Promise<ListWithSegments> {
      const list = await $fetch<ListWithSegments>(`/api/lists/${listId}/segments`, {
        params: { page, limit },
      });
      this.currentSegmentList = list;
      return list;
    },

    async addSegmentToList(listId: number, segmentUuid: string, note?: string): Promise<void> {
      await $fetch(`/api/lists/${listId}/segments`, {
        method: 'POST',
        body: { segmentUuid, ...(note ? { note } : {}) },
      });
    },

    async removeSegmentFromList(listId: number, segmentUuid: string): Promise<void> {
      await $fetch(`/api/lists/${listId}/segments/${segmentUuid}`, { method: 'DELETE' });
    },

    async updateSegmentInList(listId: number, segmentUuid: string, data: { position?: number; note?: string | null }): Promise<void> {
      await $fetch(`/api/lists/${listId}/segments/${segmentUuid}`, {
        method: 'PATCH',
        body: data,
      });
    },
  },
});
