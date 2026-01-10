// @ts-nocheck
import express from 'express';
export const router = express.Router();

import { reSyncDatabase, reSyncDatabasePartial } from '../controllers/databaseController';
import { authenticate } from '../middleware/authentication';
import { hasPermissionAPI } from '../middleware/permissionHandler';

// Get
router.get('/v1/admin/database/sync/full', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']), reSyncDatabase);
router.get('/v1/admin/database/sync/partial', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']), reSyncDatabasePartial);
