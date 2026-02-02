import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchFetchLimiter } from '@app/middleware/apiLimiterRate';
import { authenticate } from '@app/middleware/authentication';
import { hasPermissionAPI } from '@app/middleware/permissionHandler';
import { rateLimitApiQuota } from '@app/middleware/apiLimiterQuota';
import { safePath } from '@lib/utils/fs';

import {
  searchHealthCheck,
  search,
  searchMultiple,
  fetchSentenceContext,
  fetchMediaInfo,
} from '@app/controllers/searchController';

import { login, register, loginGoogle, getDiscordAuthUrl, loginDiscord } from '@app/controllers/authController';
import { logout } from '@app/controllers/authJwtController';

import {
  getUserInfo,
  getIdentityMe,
  createApiKey,
  getApiKeys,
  deactivateApiKey,
} from '@app/controllers/userController';
import { mediaIndex, mediaCreate, mediaShow, mediaUpdate, mediaDestroy } from '@app/controllers/mediaController';
import { characterShow } from '@app/controllers/characterController';
import { seiyuuShow } from '@app/controllers/seiyuuController';
import {
  listIndex,
  listShow,
  listCreate,
  listUpdate,
  listDestroy,
  listAddItem,
  listUpdateItem,
  listRemoveItem,
} from '@app/controllers/listController';
import {
  episodeIndex,
  episodeCreate,
  episodeShow,
  episodeUpdate,
  episodeDestroy,
} from '@app/controllers/episodeController';
import {
  segmentIndex,
  segmentCreate,
  segmentShow,
  segmentUpdate,
  segmentDestroy,
  segmentShowByUuid,
} from '@app/controllers/segmentController';

// Generated routers
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createAuthRouter } from 'generated/routes/auth';
import { createRouter as createAuthJwtRouter } from 'generated/routes/authjwt';
import { createRouter as createUserRouter } from 'generated/routes/user';
import { createRouter as createMediaRouter } from 'generated/routes/media';
import { createRouter as createListsRouter } from 'generated/routes/lists';

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

const MediaRoutes = createMediaRouter({
  mediaIndex,
  mediaCreate,
  mediaShow,
  mediaUpdate,
  mediaDestroy,
  characterShow,
  seiyuuShow,
  episodeIndex,
  episodeCreate,
  episodeShow,
  episodeUpdate,
  episodeDestroy,
  segmentIndex,
  segmentCreate,
  segmentShow,
  segmentUpdate,
  segmentDestroy,
  segmentShowByUuid,
});

const ListsRoutes = createListsRouter({
  listIndex,
  listCreate,
  listShow,
  listUpdate,
  listDestroy,
  listAddItem,
  listUpdateItem,
  listRemoveItem,
});

// ============================================================
// 1. Define auth requirements for specific path patterns
// These middleware run ONLY for matching paths, then call next()
// ============================================================

// JWT-protected endpoints
router.all('/v1/auth/logout', authenticate({ jwt: true }));
router.all('/v1/jwt/{*path}', authenticate({ jwt: true }));
router.all('/v1/auth/identity/{*path}', authenticate({ jwt: true }));
router.all('/v1/user/{*path}', authenticate({ jwt: true }));

// API Key-protected endpoints
router.all(
  '/v1/search/{*path}',
  searchFetchLimiter,
  authenticate({ apiKey: true }),
  hasPermissionAPI(['READ_MEDIA']),
  rateLimitApiQuota,
);

// Media endpoints - GET uses READ_MEDIA, POST uses ADD_MEDIA, PATCH uses UPDATE_MEDIA, DELETE uses REMOVE_MEDIA
router.all('/v1/media/{*path}', authenticate({ apiKey: true }), rateLimitApiQuota);
router.get('/v1/media/{*path}', hasPermissionAPI(['READ_MEDIA']));
router.post('/v1/media/{*path}', hasPermissionAPI(['ADD_MEDIA']));
router.patch('/v1/media/{*path}', hasPermissionAPI(['UPDATE_MEDIA']));
router.delete('/v1/media/{*path}', hasPermissionAPI(['REMOVE_MEDIA']));

// List endpoints - GET uses READ_LISTS, POST uses CREATE_LISTS, PATCH uses UPDATE_LISTS, DELETE uses DELETE_LISTS
router.all('/v1/lists/{*path}', authenticate({ apiKey: true }), rateLimitApiQuota);
router.get('/v1/lists/{*path}', hasPermissionAPI(['READ_LISTS']));
router.post('/v1/lists/{*path}', hasPermissionAPI(['CREATE_LISTS']));
router.patch('/v1/lists/{*path}', hasPermissionAPI(['UPDATE_LISTS']));
router.delete('/v1/lists/{*path}', hasPermissionAPI(['DELETE_LISTS']));

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

// Media - /v1/media/* (auth already checked)
router.use('/', MediaRoutes);

// Lists - /v1/lists/* (auth already checked)
router.use('/', ListsRoutes);

// Serve the OpenAPI specification file (publicly accessible, no auth required)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
router.get('/docs/openapi.yaml', (_req, res) => {
  res.setHeader('Content-Type', 'application/x-yaml');
  res.sendFile(safePath(__dirname, '../docs/generated/openapi.yaml'));
});

export { router };
