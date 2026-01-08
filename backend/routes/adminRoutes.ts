// @ts-nocheck
import express from 'express';
export const router = express.Router();

import {
  reSyncDatabase,
  reSyncDatabasePartial,
  reindexSegment,
  reindexMediaSegmentsController,
  reindexFullDatabaseController,
  getReindexStatus,
} from '../controllers/databaseController';
import { authenticate } from '../middleware/authentication';
import { hasPermissionAPI } from '../middleware/permissionHandler';

// Get
router.get('/v1/admin/database/sync/full', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']), reSyncDatabase);
router.get('/v1/admin/database/sync/partial', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']), reSyncDatabasePartial);

// Elasticsearch reindex endpoints
router.post('/v1/admin/reindex/segment/:segmentId', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']), reindexSegment);
router.post('/v1/admin/reindex/media/:mediaId/segments', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']), reindexMediaSegmentsController);
router.post('/v1/admin/reindex/database', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']), reindexFullDatabaseController);
router.get('/v1/admin/reindex/status', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']), getReindexStatus);
