import { SearchAnimeSentencesSegment } from "./querySegmentsResponse";

export interface QuerySurroundingSegmentsResponse {
    readonly context: SearchAnimeSentencesSegment[];
}