import url from "url";
import {Request, Response } from "express";
import {Send} from "express-serve-static-core";

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
export interface ControllerRequest<T> extends Request {
    body: T;
}

export interface ControllerResponse<T> extends Response {
    json: Send<T, this>;
}
