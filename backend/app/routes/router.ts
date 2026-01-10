import express from 'express';
import { searchFetchLimiter } from '@app/middleware/apiLimiterRate';
import { authenticate } from '@app/middleware/authentication';
import { hasPermissionAPI } from '@app/middleware/permissionHandler';
import { rateLimitApiQuota } from '@app/middleware/apiLimiterQuota';
import {
  searchHealthCheck,
  search,
  searchMultiple,
  fetchSentenceContext,
  fetchMediaInfo,
} from '@app/controllers/searchController';
import {
  reindexElasticsearch,
  getQueueStats,
  getQueueDetails,
  retryQueueJobs,
  getFailedJobs,
  purgeFailedJobs,
} from '@app/controllers/adminController';
import { getIdentityMe, createApiKey, getApiKeys, deactivateApiKey } from '@app/controllers/userController';
import { impersonateUserForDevelopment, clearDevelopmentImpersonation } from '@app/controllers/devAuthController';
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
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createUserRouter } from 'generated/routes/user';
import { createRouter as createMediaRouter } from 'generated/routes/media';
import { createRouter as createListsRouter } from 'generated/routes/lists';
import { createRouter as createAdminRouter } from 'generated/routes/admin';

const router = express.Router();

const SearchRoutes = createSearchRouter({
  searchHealthCheck,
  search,
  searchMultiple,
  fetchSentenceContext,
  fetchMediaInfo,
});

const UserRoutes = createUserRouter({
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

const AdminRoutes = createAdminRouter({
  reindexElasticsearch,
  getQueueStats,
  getQueueDetails,
  getFailedJobs,
  purgeFailedJobs,
  retryQueueJobs,
});

router.post('/v1/dev/auth/impersonate', impersonateUserForDevelopment);
router.post('/v1/dev/auth/impersonate/clear', clearDevelopmentImpersonation);

router.all('/v1/auth/identity', authenticate({ session: true }));
router.all('/v1/auth/identity/*path', authenticate({ session: true }));

router.all('/v1/user', authenticate({ session: true }));
router.all('/v1/user/*path', authenticate({ session: true }));

router.all(
  '/v1/search',
  searchFetchLimiter,
  authenticate({ apiKey: true }),
  hasPermissionAPI(['READ_MEDIA']),
  rateLimitApiQuota,
);
router.all(
  '/v1/search/*path',
  searchFetchLimiter,
  authenticate({ apiKey: true }),
  hasPermissionAPI(['READ_MEDIA']),
  rateLimitApiQuota,
);

router.all('/v1/admin', authenticate({ apiKey: true }), hasPermissionAPI(['ADD_MEDIA']), rateLimitApiQuota);
router.all('/v1/admin/*path', authenticate({ apiKey: true }), hasPermissionAPI(['ADD_MEDIA']), rateLimitApiQuota);

router.all('/v1/media', authenticate({ apiKey: true }), rateLimitApiQuota);
router.all('/v1/media/*path', authenticate({ apiKey: true }), rateLimitApiQuota);
router.get('/v1/media', hasPermissionAPI(['READ_MEDIA']), rateLimitApiQuota);
router.get('/v1/media/*path', hasPermissionAPI(['READ_MEDIA']), rateLimitApiQuota);
router.post('/v1/media/*path', hasPermissionAPI(['ADD_MEDIA']), rateLimitApiQuota);
router.patch('/v1/media/*path', hasPermissionAPI(['UPDATE_MEDIA']), rateLimitApiQuota);
router.delete('/v1/media/*path', hasPermissionAPI(['REMOVE_MEDIA']), rateLimitApiQuota);

router.all('/v1/lists', authenticate({ apiKey: true }), rateLimitApiQuota);
router.all('/v1/lists/*path', authenticate({ apiKey: true }), rateLimitApiQuota);
router.get('/v1/lists', hasPermissionAPI(['READ_LISTS']), rateLimitApiQuota);
router.get('/v1/lists/*path', hasPermissionAPI(['READ_LISTS']), rateLimitApiQuota);
router.post('/v1/lists/*path', hasPermissionAPI(['CREATE_LISTS']), rateLimitApiQuota);
router.patch('/v1/lists/*path', hasPermissionAPI(['UPDATE_LISTS']), rateLimitApiQuota);
router.delete('/v1/lists/*path', hasPermissionAPI(['DELETE_LISTS']), rateLimitApiQuota);

router.use('/', UserRoutes);
router.use('/', SearchRoutes);
router.use('/', MediaRoutes);
router.use('/', ListsRoutes);
router.use('/', AdminRoutes);

export { router };
