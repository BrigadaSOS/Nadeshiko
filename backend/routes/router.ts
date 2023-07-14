import express from "express";
export const router = express.Router();
import {
  reSyncDatabase,
  SyncSpecificAnime,
} from "../controllers/databaseController";
import {
  GetContextAnime,
  SearchAnimeSentences,
  generateURLAudio,
} from "../controllers/mediaController";
import { hasPermission } from "../middleware/permissionHandler";
import { isAuth } from "../middleware/authorization";

// API Routes v1
// Search
router.post("/v1/search/anime/sentence", isAuth, hasPermission(['READ_ANIME']), SearchAnimeSentences);
router.post("/v1/search/anime/context", isAuth, hasPermission(['READ_ANIME']), GetContextAnime);

// Utility
router.post("/v1/utility/merge/audio", isAuth, generateURLAudio);

// Admin
router.post("/v1/admin/database/resync", isAuth, hasPermission(['RESYNC_DATABASE']), reSyncDatabase);
router.post("/v1/admin/database/sync/anime", isAuth, SyncSpecificAnime);
