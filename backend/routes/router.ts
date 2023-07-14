import express from "express";
export const router = express.Router();
import { reSyncDatabase, SyncSpecificAnime } from "../controllers/databaseController";
import {
  GetContextAnime,
  SearchAnimeSentences,
  generateURLAudio,
} from "../controllers/mediaController";
import { isAuth } from "../middleware/authorization";

// API Routes v1
/// General
router.post("/v1/search/anime/sentence", isAuth, SearchAnimeSentences);
router.post("/v1/search/anime/context",isAuth, GetContextAnime);
router.post("/v1/utility/merge/audio", generateURLAudio);

/// Admin
router.post("/v1/admin/database/resync", isAuth, reSyncDatabase);
router.post("/v1/admin/database/sync/anime", isAuth, SyncSpecificAnime);
