import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchFetchLimiter } from '../middleware/apiLimiterRate';
import { authenticate } from '../middleware/authentication';
import { hasPermissionAPI } from '../middleware/permissionHandler';
import { rateLimitApiQuota } from '../middleware/apiLimiterQuota';
import { safePath } from '../utils/fs';

import {
  searchHealthCheck,
  search,
  searchMultiple,
  fetchSentenceContext,
  fetchMediaInfo,
} from 'controllers/searchController';

import { login, register, loginGoogle, getDiscordAuthUrl, loginDiscord } from 'controllers/authController';
import { logout } from 'controllers/authJwtController';

import { getUserInfo, getIdentityMe, createApiKey, getApiKeys, deactivateApiKey } from 'controllers/userController';

import {
  reSyncDatabase,
  reSyncDatabasePartial,
  syncSpecificMedia,
  reindexSegment,
  reindexMediaSegments,
  reindexFullDatabase,
  getReindexStatus,
} from 'controllers/adminController';

// Generated routers
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createAuthRouter } from 'generated/routes/auth';
import { createRouter as createAuthJwtRouter } from 'generated/routes/authjwt';
import { createRouter as createUserRouter } from 'generated/routes/user';
import { createRouter as createAdminRouter } from 'generated/routes/admin';

const router = express.Router();

// Create routers with implementations
const SearchRoutes = createSearchRouter({
  searchHealthCheck,
  search,
  searchMultiple,
  fetchSentenceContext,
  fetchMediaInfo,
});

const AuthRoutes = createAuthRouter({
  login,
  register,
  loginGoogle,
  getDiscordAuthUrl,
  loginDiscord,
});

const AuthJwtRoutes = createAuthJwtRouter({
  logout,
});

const UserRoutes = createUserRouter({
  getUserInfo,
  getIdentityMe,
  createApiKey,
  getApiKeys,
  deactivateApiKey,
});

const AdminRoutes = createAdminRouter({
  reSyncDatabase,
  reSyncDatabasePartial,
  syncSpecificMedia,
  reindexSegment,
  reindexMediaSegments,
  reindexFullDatabase,
  getReindexStatus,
});

// ============================================================
// 1. Define auth requirements for specific path patterns
// These middleware run ONLY for matching paths, then call next()
// ============================================================

// JWT-protected endpoints
router.all('/v1/auth/logout', authenticate({ jwt: true }));
router.all(/^\/v1\/jwt\/.*/i, authenticate({ jwt: true }));
router.all(/^\/v1\/auth\/identity\/.*/i, authenticate({ jwt: true }));
router.all(/^\/v1\/user\/.*/i, authenticate({ jwt: true }));

// API Key-protected endpoints
router.all(
  /^\/v1\/search\/.*/i,
  searchFetchLimiter,
  authenticate({ apiKey: true }),
  hasPermissionAPI(['READ_MEDIA']),
  rateLimitApiQuota,
);
router.all('/v1/admin/database/sync/full', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']));
router.all('/v1/admin/database/sync/partial', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']));
router.all('/v1/admin/database/reindex/*', authenticate({ apiKey: true }), hasPermissionAPI(['RESYNC_DATABASE']));
router.all('/v1/management/media/sync/media', authenticate({ apiKey: true }), hasPermissionAPI(['ADD_MEDIA']));

// ============================================================
// 2. Mount routers (no middleware needed - auth already checked)
// ============================================================

// Auth - Public endpoints (no auth required)
router.use('/', AuthRoutes);

// AuthJwt - /v1/auth/logout (auth already checked by router.all above)
router.use('/', AuthJwtRoutes);

// User - /v1/jwt/*, /v1/auth/identity/*, /v1/user/* (auth already checked)
router.use('/', UserRoutes);

// Search - /v1/search/* (auth already checked)
router.use('/', SearchRoutes);

// Admin - /v1/admin/*, /v1/management/* (auth already checked)
router.use('/', AdminRoutes);

// Serve the OpenAPI specification file (publicly accessible, no auth required)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
router.get('/docs/openapi.yaml', (_req, res) => {
  res.setHeader('Content-Type', 'application/x-yaml');
  res.sendFile(safePath(__dirname, '../docs/generated/openapi.yaml'));
});

export { router };
