import { Client } from '@elastic/elasticsearch'
import {
    FieldValue,
    MsearchRequestItem, MsearchResponse,
    QueryDslQueryContainer,
    SearchResponse,
    SearchResponseBody, SearchTotalHits, Sort, SortCombinations
} from "@elastic/elasticsearch/lib/api/types";
import {QueryMediaInfoResponse} from "../models/external/queryMediaInfoResponse";
import {
    QuerySegmentsResponse,
    SearchAnimeSentencesSegment,
    SearchAnimeSentencesStatistics
} from "../models/external/querySegmentsResponse";
import {queryMediaInfo} from "./database_queries";
import {getBaseUrlMedia} from "../utils/utils";
import {QueryWordsMatchedResponse, WordMatch, WordMatchMediaInfo} from "../models/external/queryWordsMatchedResponse";

export const client = new Client({
    node: process.env.ELASTICSEARCH_HOST
});


export const querySegments = async (query?: string, uuid?: string, media_id?: number, limit: number = 20, cursor?: FieldValue[]): Promise<QuerySegmentsResponse> => {
    const must: QueryDslQueryContainer[] = [];
    let sort: Sort = [];

    // Match only by uuid and return 1 result. This takes precedence over other queries
    if(uuid) {
        must.push({
            match: {
                uuid: uuid
            }
        })
    }

    // Search by query, optionally filtering by media_id to only return results from an specific anime
    if(query && !uuid) {
        must.push( {
            simple_query_string: {
                query: query,
                    fields: ["content", "content.readingform", "content_english", "content_spanish"],
                    default_operator: "and"
            },
        })

        if(media_id) {
            must.push({
                match: {
                    media_id: media_id
                }
            })
        }

        // Sort is only used when we search by a query. For uuid queries it is not included
        sort = [
            { _score: { order: "desc" } },
            { id: { order: "asc" } }
        ];
    }

    const esResponse = client.search({
        size: limit,
        sort,
        index: "nadedb",
        highlight: {
            fields: {
                content: {},
                "content.readingform": {},
                content_english: {},
                content_spanish: {}
            }
        },
        query: {
            bool: {
                must
            },
        },
        search_after: cursor,
        aggs: {
            group_by_media_id: {
                terms: {
                    field: "media_id"
                }
            }
        }
    });

    const mediaInfo = queryMediaInfo();
    return buildSearchAnimeSentencesResponse(await esResponse, await mediaInfo);
}


export const queryWordsMatched = async (words: string[]) : Promise<QueryWordsMatchedResponse> => {
    const searches: MsearchRequestItem[] = words.map((word) => {
        return [{},
            {
            size: 0,
            query: {
                    multi_match: {
                    query: word,
                        fields: ["content", "content.readingform", "content_english", "content_spanish"]
                },
            },
            aggs: {
                group_by_media_id: {
                    terms: {
                        field: "media_id"
                    }
                }
            }
        }]
    }).flat();

    const esResponse = await client.msearch({
        index: "nadedb",
        searches
    });

    const mediaInfo = await queryMediaInfo();
    return buildQueryWordsMatchedResponse(words, esResponse, mediaInfo);
}


const buildSearchAnimeSentencesResponse = (esResponse: SearchResponse, mediaInfoResponse: QueryMediaInfoResponse): QuerySegmentsResponse => {
    const sentences: SearchAnimeSentencesSegment[] = esResponse.hits.hits.map(hit => {
        const data: any = hit["_source"];
        const highlight: any = hit["highlight"] || {};
        const mediaInfo = mediaInfoResponse[Number(data["media_id"])] || {};
        const seriesNamePath = mediaInfo["folder_media_name"];
        const seasonNumberPath = `S${data["season"].toString().padStart(2, "0")}`;
        const episodeNumberPath = `E${data["episode"].toString().padStart(2, "0")}`;

        const content_jp_highlight = ("content.readingform" in highlight) ? highlight["content.readingform"][0] : ("content" in highlight) ? highlight["content"][0] : "";
        const content_en_highlight = ("content_english" in highlight) ? highlight["content_english"][0] : "";
        const content_es_highlight = ("content_spanish" in highlight) ? highlight["content_spanish"][0] : "";

        return {
            basic_info: {
                id_anime: data["media_id"],
                name_anime_en: mediaInfo.english_name,
                name_anime_jp: mediaInfo.japanese_name,
                cover: mediaInfo.cover,
                banner: mediaInfo.banner,
                episode: data["episode"],
                season: data["season"]
            },
            segment_info: {
                status: data["status"],
                uuid: data["uuid"],
                position: data["position"],
                start_time: data["start_time"],
                end_time: data["end_time"],
                content_jp: data["content"],
                content_jp_highlight,
                content_en: data["content_english"],
                content_en_highlight,
                content_en_mt: data["content_english_mt"],
                content_es: data["content_spanish"],
                content_es_highlight,
                content_es_mt: data["content_spanish_mt"],
                actor_ja: data["actor_ja"],
                actor_en: data["actor_en"],
                actor_es: data["actor_es"]
            },
            media_info: {
                path_image: [getBaseUrlMedia(), seriesNamePath, seasonNumberPath, episodeNumberPath, data["path_image"]].join("/"),
                path_audio: [getBaseUrlMedia(), seriesNamePath, seasonNumberPath, episodeNumberPath, data["path_audio"]].join("/")
            }
        }
    });

    let statistics: SearchAnimeSentencesStatistics[] = [];
    if(esResponse.aggregations && "group_by_media_id" in esResponse.aggregations) {
        // @ts-ignore
        statistics = esResponse.aggregations["group_by_media_id"].buckets.map((bucket  : any) => {
            const mediaInfo = mediaInfoResponse[Number(bucket["key"])];

            return {
                anime_id: bucket["key"],
                name_anime_en: mediaInfo.english_name,
                name_anime_jp: mediaInfo.japanese_name,
                amount_sentences_found: bucket["doc_count"]
            }
        });
    }

    let cursor: FieldValue[] | undefined = undefined;
    if(esResponse.hits.hits.length >= 1) {
        cursor = esResponse.hits.hits[esResponse.hits.hits.length - 1]["sort"];
    }

    return {
        statistics: statistics,
        sentences,
        cursor
    }
}

const buildQueryWordsMatchedResponse = (words: string[], esResponse: MsearchResponse, mediaInfoResponse: QueryMediaInfoResponse): QueryWordsMatchedResponse => {
    // Elasticsearch's responses are returned in the exact same order as the words array, so we can iterate them side by side
    const results: WordMatch[] = []

    for(const [word, response] of words.map((word, i): [string, SearchResponseBody]  => [word, esResponse.responses[i] as SearchResponseBody])) {
        let is_match = false;
        let total_matches = 0;

        if(response.hits !== undefined && response.hits.total !== undefined) {
            is_match = (response.hits.total as SearchTotalHits).value > 0;
            total_matches = (response.hits.total as SearchTotalHits).value;
        }

        let media: WordMatchMediaInfo[] = [];
        if(response.aggregations && "group_by_media_id" in response.aggregations) {
            // @ts-ignore
            media = response.aggregations["group_by_media_id"].buckets.map((bucket: any) : WordMatchMediaInfo=> {
                const mediaInfo = mediaInfoResponse[Number(bucket["key"])];

                return {
                    media_id: mediaInfo["media_id"],
                    english_name: mediaInfo["english_name"],
                    japanese_name: mediaInfo["japanese_name"],
                    romaji_name: mediaInfo["romaji_name"],
                    matches: bucket["doc_count"]
                }
            });
        }

        results.push({
            word,
            is_match,
            total_matches,
            media
        });
    }

    return {
        results
    }
}

