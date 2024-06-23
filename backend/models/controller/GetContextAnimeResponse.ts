import {SearchAnimeSentencesSegment} from "../external/querySegmentsResponse";

export interface GetContextAnimeResponse {
    readonly sentences: SearchAnimeSentencesSegment[];
}