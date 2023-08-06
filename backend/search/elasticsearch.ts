import { Client } from '@elastic/elasticsearch'
import {FieldValue, QueryDslQueryContainer} from "@elastic/elasticsearch/lib/api/types";

export const client = new Client({
    node: process.env.ELASTICSEARCH_HOST
});


export const searchSegments = async (query: string, uuid?: string, media_id?: number, limit: number = 10, search_after?: FieldValue[])=> {
    const must: QueryDslQueryContainer[] = [];

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
    }

    return client.search({
        size: limit,
        index: "nadedb",
        sort: [
            { _score: { order: "desc" } },
            { id: { order: "asc" } }
        ],
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
        search_after,
        aggs: {
            group_by_media_id: {
                terms: {
                    field: "media_id"
                }
            }
        }
    });
}