import { SearchAnimeSentencesSegment } from "./querySegmentsResponse";

export interface QuerySurroundingSegmentsResponse {
    readonly sentences: SearchAnimeSentencesSegment[];
}