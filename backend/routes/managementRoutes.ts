// @ts-nocheck
import express from 'express';
export const router = express.Router();

import { SyncSpecificMedia } from '../controllers/databaseController';
import { authenticate } from '../middleware/authentication';
import { hasPermissionAPI } from '../middleware/permissionHandler';

// Post
router.post(
  '/v1/management/media/sync/media',
  authenticate({ apiKey: true }),
  hasPermissionAPI(['ADD_MEDIA']),
  SyncSpecificMedia,
);
