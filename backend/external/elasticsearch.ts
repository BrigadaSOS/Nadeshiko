import {Client} from '@elastic/elasticsearch'
import {
    FieldValue,
    MsearchRequestItem,
    MsearchResponse, QueryDslOperator,
    QueryDslQueryContainer,
    SearchResponse,
    SearchResponseBody,
    SearchTotalHits,
    Sort, SortOrder,
} from "@elastic/elasticsearch/lib/api/types";
import {QueryMediaInfoResponse} from "../models/external/queryMediaInfoResponse";
import {
    QuerySegmentsResponse,
    SearchAnimeSentencesSegment,
    SearchAnimeSentencesStatistics
} from "../models/external/querySegmentsResponse";
import {queryMediaInfo} from "./database_queries";
import {getBaseUrlMedia, notEmpty} from "../utils/utils";
import {QueryWordsMatchedResponse, WordMatch, WordMatchMediaInfo} from "../models/external/queryWordsMatchedResponse";
import {logger} from "../utils/log";
import {QuerySegmentsRequest} from "../models/external/querySegmentsRequest";


export const client = new Client({
    node: process.env.ELASTICSEARCH_HOST,
    auth: {
        username: 'elastic',
        password: process.env.ELASTICSEARCH_PASSWORD || ""
    }
});

export const querySegments = async (request: QuerySegmentsRequest): Promise<QuerySegmentsResponse> => {
    const must: QueryDslQueryContainer[] = [];
    const filter: QueryDslQueryContainer[] = [];
    let sort: Sort = [];

    // Match only by uuid and return 1 result. This takes precedence over other queries
    if(request.uuid) {
        must.push({
            match: {
                uuid: request.uuid
            }
        })
    }

    // Search by query, optionally filtering by media_id to only return results from an specific anime
    if(request.query && !request.uuid) {
        if(request.length_sort_order && request.length_sort_order.toLowerCase() === "random") {
            const seed = request.random_seed || undefined;

            must.push({
                function_score: {
                    query: {
                        bool: {
                            should: buildMultiLanguageQuery(request.query, request.exact_match || false)
                        }
                    },
                    functions: [
                        {
                            random_score: {
                                field: "_seq_no",
                                seed: seed
                            }
                        }
                    ],
                    boost_mode: "multiply"
                },
            })
        } else {
            must.push({
                bool: {
                    should: buildMultiLanguageQuery(request.query, request.exact_match || false)
                }
            })
        }

        filter.push({
            terms: {
                status: request.status
            }
        })

        if(request.anime_id) {
            filter.push(
                {
                    term: {
                        media_id: request.anime_id
                    }
                }
            )
        }

        if(request.media) {
            const mediaQueries :QueryDslQueryContainer[] = request.media.flatMap((mediaFilter) => {
                if(!mediaFilter.seasons) {
                    return {
                        bool: {
                            must: [
                                {
                                    term: {
                                        media_id: {
                                            value: mediaFilter.media_id
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }

                return mediaFilter.seasons.flatMap((season) => {
                    if(!season.episodes) {
                        return {
                            bool: {
                                must: [
                                    {
                                        term: {
                                            media_id: {
                                                value: mediaFilter.media_id
                                            }
                                        }
                                    },
                                    {
                                        term: {
                                            season: {
                                                value: season.season
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }

                    return season.episodes.flatMap((episode) => {
                        return {
                            bool: {
                                must: [
                                    {
                                        term: {
                                            media_id: {
                                                value: mediaFilter.media_id
                                            }
                                        }
                                    },
                                    {
                                        term: {
                                            season: {
                                                value: season.season
                                            }
                                        }
                                    },
                                    {
                                        term: {
                                            episode: {
                                                value: episode
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    })
                })
            })

            filter.push({
                bool: {
                    should: mediaQueries
                }
            });
        }

        // Sort is only used when we search by a query. For uuid queries it is not included
        if(!request.length_sort_order || request.length_sort_order === "none") {
            sort = [
                { _score: { order: "desc" } },
                { content_length: { order: "asc"} }
            ];
        } else if(request.length_sort_order === "random") {
            // Score is randomized, but with this is required for cursor field to appear
            sort = [
                { _score: { order: "desc" } },
                { content_length: { order: "asc"} }
            ];
        } else {
            // Override score order when defining sort order
            sort = [
                { content_length: { order: request.length_sort_order as SortOrder } }
            ];
        }
    }

    const esResponse = client.search({
        size: request.limit,
        sort,
        index: "nadedb",
        highlight: {
            fields: {
                content: {},
                "content.readingform": {},
                content_english: {},
                "content_english.exact": {},
                content_spanish: {},
                "content_spanish.exact": {}
            }
        },
        query: {
            bool: {
                filter,
                must
            },
        },
        search_after: request.cursor,
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
                bool: {
                    should: buildMultiLanguageQuery(word, true)
                }
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
        const mediaInfo = mediaInfoResponse.results[Number(data["media_id"])] || {};
        const seriesNamePath = mediaInfo["folder_media_name"];
        const seasonNumberPath = `S${data["season"].toString().padStart(2, "0")}`;
        const episodeNumberPath = `E${data["episode"].toString().padStart(2, "0")}`;

        const content_jp_highlight = ("content.readingform" in highlight) ? highlight["content.readingform"][0] : ("content" in highlight) ? highlight["content"][0] : "";
        const content_en_highlight = ("content_english" in highlight) ? highlight["content_english"][0] : ("content_english.exact" in highlight) ? highlight["content_english.exact"][0] : "";
        const content_es_highlight = ("content_spanish" in highlight) ? highlight["content_spanish"][0] : ("content_spanish.exact" in highlight) ? highlight["content_spanish.exact"][0] : "";
        
        if(!mediaInfo || !Object.keys(mediaInfo).length) {
            logger.error("Media Info not found for anime with id %s", data["media_id"])
            return;
        }

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
                is_nsfw: data["is_nsfw"],
                actor_ja: data["actor_ja"],
                actor_en: data["actor_en"],
                actor_es: data["actor_es"]
            },
            media_info: {
                path_image: [getBaseUrlMedia(), seriesNamePath, seasonNumberPath, episodeNumberPath, data["path_image"]].join("/"),
                path_audio: [getBaseUrlMedia(), seriesNamePath, seasonNumberPath, episodeNumberPath, data["path_audio"]].join("/"),
                path_video: [getBaseUrlMedia(), seriesNamePath, seasonNumberPath, episodeNumberPath, `${data["position"]}.mp4`].join("/")
            }
        }
    }).filter(notEmpty);

    let statistics: SearchAnimeSentencesStatistics[] = [];
    if(esResponse.aggregations && "group_by_media_id" in esResponse.aggregations) {
        // @ts-ignore
        statistics = esResponse.aggregations["group_by_media_id"].buckets.map((bucket  : any) => {
            const mediaInfo = mediaInfoResponse.results[Number(bucket["key"])];
            if(!mediaInfo || !Object.keys(mediaInfo).length) {
                return;
            }

            return {
                anime_id: bucket["key"],
                name_anime_en: mediaInfo.english_name,
                name_anime_jp: mediaInfo.japanese_name,
                amount_sentences_found: bucket["doc_count"]
            }
        }).filter(notEmpty);
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
                const mediaInfo = mediaInfoResponse.results[Number(bucket["key"])];

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



const buildMultiLanguageQuery = (query: string, exact_match: boolean): QueryDslQueryContainer[] => {
    const languageQueries : QueryDslQueryContainer[] = [
        {
            "query_string": {
                "query": (exact_match) ? `"${query}"` : query,
                "analyze_wildcard": true,
                "allow_leading_wildcard": false,
                "fuzzy_transpositions": false,
                "fields": (exact_match) ? ["content"] : ["content^3", "content.readingform"],
                "default_operator": "AND",
                "quote_analyzer": "ja_original_search_analyzer"
            }
        },
    ]

    if(exact_match) {
        languageQueries.push(...[
            {
                "multi_match": {
                    "query": query,
                    "fields": ["content_spanish.exact"]
                }
            },
            {
                "multi_match": {
                    "query": query,
                    "fields": ["content_english.exact"]
                }
            }
        ])
    } else {
        languageQueries.push(...[
            {
                query_string: {
                    query,
                    analyze_wildcard: true,
                    allow_leading_wildcard: false,
                    fuzzy_transpositions: false,
                    fields: ["content_spanish"],
                    default_operator: "AND" as QueryDslOperator,
                    quote_field_suffix: ".exact"
                }
            },
            {
                query_string: {
                    query,
                    analyze_wildcard: true,
                    allow_leading_wildcard: false,
                    fuzzy_transpositions: false,
                    fields: ["content_english"],
                    default_operator: "AND" as QueryDslOperator,
                    quote_field_suffix: ".exact"
                }
            }
        ])
    }

    return languageQueries;
}