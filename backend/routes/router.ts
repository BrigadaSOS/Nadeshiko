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
  GetAllAnimes,
  updateSegment
} from "../controllers/mediaController";
import { isAuth } from "../middleware/authorization";
import { hasPermission } from "../middleware/permissionHandler";
import { isAuthJWT, requireRole, ADMIN, MOD, USER } from "../middleware/isAuthJWT";
import { signUp, logIn, logout, getUserInfo, loginGoogle, sendReportSegment } from "../controllers/userController";
import { getFilesFromDirectory, createFolder, deleteFolderOrFile, compressDirectory, uploadFile, dynamicStorage, downloadFile } from "../controllers/explorerController"


/* --- JWT Endpoints --- */
// User
router.post('/v1/jwt/user/info', isAuthJWT, requireRole(ADMIN, MOD, USER), getUserInfo)
router.post('/v1/jwt/user/logout', isAuthJWT, requireRole(ADMIN, MOD, USER), logout)

// File Explorer
router.post("/v1/jwt/files/createFolder", isAuthJWT, requireRole(ADMIN), createFolder)
router.post("/v1/jwt/files/deleteFolderOrFile", isAuthJWT, requireRole(ADMIN), deleteFolderOrFile)
router.post("/v1/jwt/files/upload", isAuthJWT, requireRole(ADMIN), dynamicStorage, uploadFile)
router.get("/v1/jwt/files/compress", isAuthJWT, requireRole(ADMIN), compressDirectory)
router.get("/v1/jwt/files", isAuthJWT, requireRole(ADMIN), getFilesFromDirectory)
router.get("/v1/jwt/files/download", isAuthJWT, requireRole(ADMIN), downloadFile)

// Report
router.post("/v1/jwt/utility/report/segment", isAuthJWT, requireRole(ADMIN, MOD, USER), sendReportSegment)

/* --- API Key Endpoints --- */
// Database
router.post("/v1/api/admin/database/resync/full", isAuth, hasPermission(['RESYNC_DATABASE']), reSyncDatabase);
router.post("/v1/api/admin/database/resync/partial", isAuth, hasPermission(['RESYNC_DATABASE']), reSyncDatabasePartial);
router.post("/v1/api/admin/database/sync/anime", isAuth, hasPermission(['ADD_ANIME', 'UPDATE_ANIME']), SyncSpecificAnime);

// User
router.post("/v1/api/user/login", isAuth, logIn);
router.post("/v1/api/user/login/google", isAuth, loginGoogle)
router.post("/v1/api/user/register", isAuth, hasPermission(['CREATE_USER']), signUp);

// Search
router.post("/v1/api/search/anime/sentence", isAuth, hasPermission(['READ_ANIME']), SearchAnimeSentences);
router.post("/v1/api/search/anime/context", isAuth, hasPermission(['READ_ANIME']), GetContextAnime);
router.post('/v1/api/search/anime/words/match', isAuth, hasPermission(['READ_ANIME']), GetWordsMatched)
router.get('/v1/api/search/anime/info', isAuth, hasPermission(['READ_ANIME']), GetAllAnimes)

// Segment
router.put("/v1/api/segment", isAuth, hasPermission(['UPDATE_ANIME']), updateSegment);

// Miscelaneous
router.post("/v1/api/utility/merge/audio", isAuth, generateURLAudio);