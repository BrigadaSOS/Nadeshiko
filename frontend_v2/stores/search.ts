
export const useApiSearch = defineStore("search", {
  actions: {
    async getRecentMedia() {
      const config = useRuntimeConfig();
      const data = await $fetch(
        `${config.public.baseURLBackend}search/media/info`,
        {
          method: "GET",
          params: { size: "10", sorted: true },
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include"
        }
      );
      return data;
    },
    async getSentenceV1(body:any) {
      const config = useRuntimeConfig();
      const data = await $fetch(
        `${config.public.baseURLBackend}search/media/sentence`,
        {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          body:{
            query: body.query,                         // Text or sentence to search 
            limit: body.limit,                         // Max amount of entries by response
            uuid: body.uuid,                           // Unique ID from sentence (Useful to get a specific sentence)
            category: body.category,                   // Anime, Liveaction
            anime_id: body.anime_id,                   // Unique ID from media
            season: body.season,                       // Array of seasons to get
            episode: body.episode,                     // Array of episodes to get
            random_seed: body.random_seed,             // A value from 0 to 1 
            content_sort: body.content_sort,           // Order by amount of characters (ASC, DESC)
            cursor: body.cursor                        // Current page of search   
          }
        }
      );
      return data;
    },
    async getMultipleSearch(body:any) {
      const config = useRuntimeConfig();
      const data = await $fetch(
        `${config.public.baseURLBackend}search/media/match/words`,
        {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          body:{
            words: body.words,  
          }
        }
      );
      return data;
    },
    async getContextSentence(body:any) {
      const config = useRuntimeConfig();
      const data = await $fetch(
        `${config.public.baseURLBackend}search/media/context`,
        {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          body:{
            media_id: body.media_id,
            season: body.season,
            episode: body.episode,
            segment_position: body.segment_position,
            limit: body.limit
          }
        }
      );
      return data;
    },
  },
});
