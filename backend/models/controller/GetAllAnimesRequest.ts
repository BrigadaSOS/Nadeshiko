import {Query} from "express-serve-static-core";

export interface GetAllAnimesRequest extends Query {
    readonly size?: string;
    readonly sorted?: string;
}