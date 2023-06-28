import express from "express";
export const router = express.Router();
import { reSyncDatabase } from "../controllers/databaseController";
import {
  GetContextAnime,
  SearchAnimeSentences,
  mergeMp3Files,
} from "../controllers/mediaController";

// API Routes v1
/// General
router.post("/v1/search/anime/sentence", SearchAnimeSentences);
router.post("/v1/search/anime/context", GetContextAnime);
router.post("/v1/utility/merge/audio", mergeMp3Files);

/// Admin
router.get("/v1/admin/database/resync", reSyncDatabase);
