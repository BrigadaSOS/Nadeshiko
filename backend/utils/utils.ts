import url from 'url';
import { Request, Response } from 'express';
import { Send, Query, ParamsDictionary } from 'express-serve-static-core';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const PROTOCOL = process.env.ENVIRONMENT === 'production' ? 'https' : 'http';
export const getBaseUrlMedia = () => {
  return url.format({
    protocol: PROTOCOL,
    host: process.env['BASE_URL_MEDIA'],
  });
};

export const getBaseUrlTmp = () => {
  return url.format({
    protocol: PROTOCOL,
    host: process.env['BASE_URL_TMP'],
  });
};

export const generateApiKey = () => {
  return uuidv4();
};

export const generateApiKeyHint = (apiKey: string) => {
  const visibleCharacters = 4;
  const maskedSection = '*'.repeat(10);
  return `${apiKey.substring(0, visibleCharacters)}${maskedSection}${apiKey.substring(apiKey.length - visibleCharacters)}`;
};

export const hashApiKey = (apiKey: string) => {
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  return hashedKey;
};

// Reference: https://javascript.plainenglish.io/typed-express-request-and-response-with-typescript-7277aea028c
export type ControllerRequest<ReqBody, ReqQuery extends Query = Query> = Request<
  ParamsDictionary,
  any,
  ReqBody,
  ReqQuery
>;

export interface ControllerResponse<T> extends Response {
  json: Send<T, this>;
}

// https://stackoverflow.com/questions/43118692/typescript-filter-out-nulls-from-an-array
export function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined;
}
