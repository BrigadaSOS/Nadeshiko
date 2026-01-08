// @ts-nocheck
import express from 'express';
export const router = express.Router();

import {
  reSyncDatabase,
  reSyncDatabasePartial,
  resyncSegment,
  resyncMediaSegments,
  getSyncStatus,
} from '../controllers/databaseController';
import { authenticate } from '../middleware/authentication';

// Database sync endpoints
router.get('/v1/admin/database/sync/full', reSyncDatabase);
router.get('/v1/admin/database/sync/partial', authenticate({ apiKey: true }), reSyncDatabasePartial);

// Elasticsearch sync endpoints
router.post('/v1/admin/sync/segment/:segmentId', authenticate({ apiKey: true }), resyncSegment);
router.post('/v1/admin/sync/media/:mediaId/segments', authenticate({ apiKey: true }), resyncMediaSegments);
router.get('/v1/admin/sync/status', authenticate({ apiKey: true }), getSyncStatus);
