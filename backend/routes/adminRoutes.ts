// @ts-nocheck
import express from 'express';
export const router = express.Router();

import { reSyncDatabase, reSyncDatabasePartial } from '../controllers/databaseController';
import { authenticate } from '../middleware/authentication';

// Get
router.get('/v1/admin/database/sync/full', reSyncDatabase);
router.get('/v1/admin/database/sync/partial', authenticate({ apiKey: true }), reSyncDatabasePartial);
