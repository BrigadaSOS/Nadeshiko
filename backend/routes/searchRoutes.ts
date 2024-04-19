// @ts-nocheck
import express from "express";
export const router = express.Router();

import { authenticate } from "../middleware/authentication";
import { rateLimitApiQuota } from "../middleware/apiLimiterQuota"
import { getAllMedia } from "../controllers/mediaController";
import { hasPermissionAPI } from "../middleware/permissionHandler";
import { GetContextAnime, SearchAnimeSentences, GetWordsMatched, updateSegment } from "../controllers/mediaController";
import { searchFetchLimiter } from "../middleware/apilLimiterRate"

// Get
router.get('/v1/search/media/info', authenticate({ apiKey: true }), hasPermissionAPI(['READ_MEDIA']), getAllMedia)

// Post
router.post("/v1/search/media/sentence", searchFetchLimiter, authenticate({ apiKey: true }), hasPermissionAPI(['READ_MEDIA']), rateLimitApiQuota, SearchAnimeSentences);
router.post("/v1/search/media/context", searchFetchLimiter, authenticate({ apiKey: true }), hasPermissionAPI(['READ_MEDIA']), rateLimitApiQuota, GetContextAnime);
router.post('/v1/search/media/match/words', searchFetchLimiter, authenticate({ apiKey: true }), hasPermissionAPI(['READ_MEDIA']), rateLimitApiQuota, GetWordsMatched)
