// @ts-nocheck

import express from "express";
export const router = express.Router();
import {
  reSyncDatabase,
  reSyncDatabasePartial,
  SyncSpecificAnime,
} from "../controllers/databaseController";
import {
  GetContextAnime,
  SearchAnimeSentences,
  generateURLAudio,
  GetWordsMatched,
  GetAllAnimes
} from "../controllers/mediaController";
import { signUp, logIn, logout, getUserInfo, loginGoogle } from "../controllers/userController";
import { hasPermission } from "../middleware/permissionHandler";
import { isAuth } from "../middleware/authorization";
import { isAuthJWT, requireRole, ADMIN, MOD, USER } from "../middleware/isAuthJWT";

// API Routes v1
// isAuth is for authentication using keys
// isAuthJWT is for authentication using JWT 

////////// AUTH KEYS
// Search
router.post("/v1/search/anime/sentence", isAuth, hasPermission(['READ_ANIME']), SearchAnimeSentences);
router.post("/v1/search/anime/context", isAuth, hasPermission(['READ_ANIME']), GetContextAnime);
router.post("/v1/search/anime/info", isAuth, hasPermission(['READ_ANIME']), GetContextAnime);
router.post('/v1/search/anime/words/match', isAuth, hasPermission(['READ_ANIME']), GetWordsMatched)
router.get('/v1/search/anime/info', isAuth, hasPermission(['READ_ANIME']), GetAllAnimes)

// Utility
router.post("/v1/utility/merge/audio", isAuth, generateURLAudio);

// Admin
router.post("/v1/admin/database/resync/full", reSyncDatabase);
router.post("/v1/admin/database/resync/partial", reSyncDatabasePartial);

router.post("/v1/admin/database/sync/anime", isAuth, hasPermission(['READ_ANIME', 'ADD_ANIME', 'REMOVE_ANIME', 'UPDATE_ANIME']), SyncSpecificAnime);

////////// AUTH JWT
// User
router.post("/v1/user/register", isAuth, signUp);
router.post("/v1/user/login", isAuth, logIn);
router.post("/v1/user/login/google", isAuth, loginGoogle)
router.post("/v1/user/logout", logout);
router.post('/v1/user/info', isAuthJWT, requireRole(ADMIN, MOD, USER), getUserInfo)

