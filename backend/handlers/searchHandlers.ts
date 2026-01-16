/**
 * OpenAPI-generated handlers for search endpoints
 *
 * NOTE: These handlers are thin wrappers that call service functions.
 * The service layer handles business logic and data fetching.
 */

import type {
  SearchSentence,
  SearchMultipleWords,
  GetContextSentence,
  GetRecentMedia,
  SearchHealth,
} from '../generated/generated';
import * as SearchService from '../services/searchService';
import { toErrorResponse, getStatusCode } from '../utils/apiErrors';

/**
 * Handler for GET /search/health
 */
export const searchHealth: SearchHealth = async (_params, respond, _req, _res, _next) => {
  try {
    const result = await SearchService.searchHealth();
    return respond.with200().body(result);
  } catch (error) {
    const errorResponse = toErrorResponse(error);
    const statusCode = getStatusCode(errorResponse);
    // @ts-ignore - Dynamic error response method
    return respond[`with${statusCode}`]().body(errorResponse);
  }
};

/**
 * Handler for POST /search/media/sentence
 */
export const searchSentence: SearchSentence = async ({ body }, respond, req, _res, _next) => {
  try {
    const result = await SearchService.searchAnimeSentences(body, req);
    return respond.with200().body(result);
  } catch (error) {
    const errorResponse = toErrorResponse(error);
    const statusCode = getStatusCode(errorResponse);
    // @ts-ignore - Dynamic error response method
    return respond[`with${statusCode}`]().body(errorResponse);
  }
};

/**
 * Handler for POST /search/media/match/words
 */
export const searchMultipleWords: SearchMultipleWords = async ({ body }, respond, _req, _res, _next) => {
  try {
    const result = await SearchService.getWordsMatched(body);
    return respond.with200().body(result);
  } catch (error) {
    const errorResponse = toErrorResponse(error);
    const statusCode = getStatusCode(errorResponse);
    // @ts-ignore - Dynamic error response method
    return respond[`with${statusCode}`]().body(errorResponse);
  }
};

/**
 * Handler for POST /search/media/context
 */
export const getContextSentence: GetContextSentence = async ({ body }, respond, _req, _res, _next) => {
  try {
    const result = await SearchService.getContextAnime(body);
    return respond.with200().body(result);
  } catch (error) {
    const errorResponse = toErrorResponse(error);
    const statusCode = getStatusCode(errorResponse);
    // @ts-ignore - Dynamic error response method
    return respond[`with${statusCode}`]().body(errorResponse);
  }
};

/**
 * Handler for GET /search/media/info
 */
export const getRecentMedia: GetRecentMedia = async ({ query }, respond, _req, _res, _next) => {
  try {
    const result = await SearchService.getAllMedia(query);
    return respond.with200().body(result);
  } catch (error) {
    const errorResponse = toErrorResponse(error);
    const statusCode = getStatusCode(errorResponse);
    // @ts-ignore - Dynamic error response method
    return respond[`with${statusCode}`]().body(errorResponse);
  }
};
