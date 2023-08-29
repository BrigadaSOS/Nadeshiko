import url from "url";
import {Request, Response } from "express";
import {Send, Query, ParamsDictionary} from "express-serve-static-core";

const PROTOCOL = (process.env.ENVIRONMENT === "production") ? "https" : "http";
export const getBaseUrlMedia = () => {
    return url.format({
        protocol: PROTOCOL,
        host: process.env["BASE_URL_MEDIA"]
    });
}

export const getBaseUrlTmp = () => {
    return url.format({
        protocol: PROTOCOL,
        host: process.env["BASE_URL_TMP"]
    });
}


// Reference: https://javascript.plainenglish.io/typed-express-request-and-response-with-typescript-7277aea028c
export interface ControllerRequest<ReqBody, ReqQuery extends Query = Query> extends Request<ParamsDictionary, any, ReqBody, ReqQuery> {}

export interface ControllerResponse<T> extends Response {
    json: Send<T, this>;
}

// https://stackoverflow.com/questions/43118692/typescript-filter-out-nulls-from-an-array
export function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
    if (value === null || value === undefined) return false;
    const testDummy: TValue = value;
    return true;
}

