// @ts-nocheck
import express from "express";
export const router = express.Router();

import { SyncSpecificMedia } from "../controllers/databaseController";
import { authenticate } from "../middleware/authentication";

// Post
router.post("/v1/management/media/sync/media", authenticate({ apiKey: true }), SyncSpecificMedia);
