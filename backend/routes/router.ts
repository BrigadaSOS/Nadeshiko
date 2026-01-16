import express from 'express';
import { router as AdminRoutes } from './adminRoutes';
import { router as ManagementRoutes } from './managementRoutes';
import { router as UserRoutes } from './userRoutes';
import { router as OpenapiRoutes } from './openapiRoutes';
import { createRouter } from '../generated/generated';
import {
  searchSentence,
  searchMultipleWords,
  getContextSentence,
  getRecentMedia,
  searchHealth,
} from '../handlers/searchHandlers';

// Import middleware needed for search routes
import { authenticate } from '../middleware/authentication';
import { rateLimitApiQuota } from '../middleware/apiLimiterQuota';
import { hasPermissionAPI } from '../middleware/permissionHandler';
import { searchFetchLimiter } from '../middleware/apilLimiterRate';

const router = express.Router();

// Create generated router with OpenAPI-based handlers
const generatedRouter = createRouter({
  searchSentence,
  searchMultipleWords,
  getContextSentence,
  getRecentMedia,
  searchHealth,
});

// Mount all route modules
router.use(AdminRoutes);
router.use(ManagementRoutes);
router.use(UserRoutes);
router.use(OpenapiRoutes);

// NOTE: All search endpoints are now handled by the OpenAPI-generated router.
// The old searchRoutes.ts file has been deprecated and is no longer used.

// Mount generated router with required middleware
// The generated router handles:
// - GET /search/health
// - POST /search/media/sentence
// - POST /search/media/match/words
// - POST /search/media/context
// - GET /search/media/info
router.use(
  '/v1',
  searchFetchLimiter,
  authenticate({ apiKey: true }),
  hasPermissionAPI(['READ_MEDIA']),
  rateLimitApiQuota,
  generatedRouter,
);

export { router };
