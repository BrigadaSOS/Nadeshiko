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
  GetWordsMatched,
  GetAllAnimes
} from "../controllers/mediaController";
import { signUp, login } from "../controllers/userController";
import { hasPermission } from "../middleware/permissionHandler";
import { isAuth } from "../middleware/authorization";

// API Routes v1
// Search
router.post("/v1/search/anime/sentence", isAuth, hasPermission(['READ_ANIME']), SearchAnimeSentences);
router.post("/v1/search/anime/context", isAuth, hasPermission(['READ_ANIME']), GetContextAnime);
router.post("/v1/search/anime/info", isAuth, hasPermission(['READ_ANIME']), GetContextAnime);
router.post('/v1/search/anime/words/match', isAuth, hasPermission(['READ_ANIME']), GetWordsMatched)
router.get('/v1/search/anime/info', isAuth, hasPermission(['READ_ANIME']), GetAllAnimes)

// Utility
router.post("/v1/utility/merge/audio", isAuth, generateURLAudio);

// User
router.post("/v1/user/register", isAuth, signUp);

// Admin
router.post("/v1/admin/database/resync", reSyncDatabase);
router.post("/v1/admin/database/sync/anime", isAuth, hasPermission(['READ_ANIME', 'ADD_ANIME', 'REMOVE_ANIME', 'UPDATE_ANIME']), SyncSpecificAnime);
