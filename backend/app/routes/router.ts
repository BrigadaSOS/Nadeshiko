import express from 'express';
import { requireSessionAuth } from '@app/middleware/authentication';
import {
  apiKeyOnly,
  enforceAdminAccess,
  mediaAddPermission,
  mediaReadPermission,
  mediaRemovePermission,
  mediaUpdatePermission,
  requireApiKeyOrSession,
  searchAccess,
} from '@app/middleware/routePolicies';
import { search, getSearchStats, searchWords } from '@app/controllers/searchController';
import { getAdminHealth, getAdminDashboard, triggerReindex } from '@app/controllers/adminController';
import {
  listAdminQueueStats,
  getAdminQueue,
  retryAdminQueueFailed,
  listAdminQueueFailed,
  purgeAdminQueueFailed,
} from '@app/controllers/queueController';
import { impersonateAdminUser, clearAdminImpersonation } from '@app/controllers/devAuthController';
import {
  listMedia,
  createMedia,
  getMedia,
  updateMedia,
  deleteMedia,
  autocompleteMedia,
} from '@app/controllers/mediaController';
import { getCharacter } from '@app/controllers/characterController';
import { getSeiyuu } from '@app/controllers/seiyuuController';
import {
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  addSegmentToCollection,
  updateCollectionSegment,
  removeSegmentFromCollection,
  searchCollectionSegments,
  getCollectionStats,
} from '@app/controllers/collectionController';
import {
  listSeries,
  getSeries,
  createSeries,
  updateSeries,
  deleteSeries,
  addMediaToSeries,
  updateSeriesMedia,
  removeMediaFromSeries,
} from '@app/controllers/seriesController';
import {
  listEpisodes,
  createEpisode,
  getEpisode,
  updateEpisode,
  deleteEpisode,
} from '@app/controllers/episodeController';
import {
  listSegments,
  createSegment,
  getSegment,
  updateSegment,
  deleteSegment,
  getSegmentByUuid,
  getSegmentContext,
  updateSegmentByUuid,
} from '@app/controllers/segmentController';
import { getUserQuota } from '@app/controllers/userQuotaController';
import { createUserReport, listAdminReports, updateAdminReport } from '@app/controllers/reportController';
import { getUserPreferences, updateUserPreferences } from '@app/controllers/preferencesController';
import { listUserLabs, enrollUserLab, unenrollUserLab } from '@app/controllers/labsController';
import {
  listUserActivity,
  getUserActivityHeatmap,
  getUserActivityStats,
  deleteUserActivity,
  trackUserActivity,
  deleteUserActivityByDate,
  deleteUserActivityById,
} from '@app/controllers/activityController';
import { exportUserData } from '@app/controllers/userExportController';
import {
  listAdminMediaAudits,
  updateAdminMediaAudit,
  runAdminMediaAudit,
  listAdminMediaAuditRuns,
  getAdminMediaAuditRun,
} from '@app/controllers/mediaAuditController';
import { createRouter as createSearchRouter } from 'generated/routes/search';
import { createRouter as createMediaRouter } from 'generated/routes/media';
import { createRouter as createCollectionsRouter } from 'generated/routes/collections';
import { createRouter as createAdminRouter } from 'generated/routes/admin';
import { createRouter as createUserRouter } from 'generated/routes/user';

const router = express.Router();

const SearchRoutes = createSearchRouter({
  search,
  getSearchStats,
  searchWords,
});

const MediaRoutes = createMediaRouter({
  listMedia,
  createMedia,
  autocompleteMedia,
  getMedia,
  updateMedia,
  deleteMedia,
  listEpisodes,
  createEpisode,
  getEpisode,
  updateEpisode,
  deleteEpisode,
  listSegments,
  createSegment,
  getSegment,
  updateSegment,
  deleteSegment,
  getSegmentByUuid,
  getSegmentContext,
  updateSegmentByUuid,
  listSeries,
  createSeries,
  getSeries,
  updateSeries,
  deleteSeries,
  addMediaToSeries,
  updateSeriesMedia,
  removeMediaFromSeries,
  getCharacter,
  getSeiyuu,
});

const CollectionsRoutes = createCollectionsRouter({
  listCollections,
  createCollection,
  getCollection,
  updateCollection,
  deleteCollection,
  addSegmentToCollection,
  updateCollectionSegment,
  removeSegmentFromCollection,
  searchCollectionSegments,
  getCollectionStats,
});

const AdminRoutes = createAdminRouter({
  getAdminDashboard,
  getAdminHealth,
  triggerReindex,
  listAdminQueueStats,
  getAdminQueue,
  listAdminQueueFailed,
  retryAdminQueueFailed,
  purgeAdminQueueFailed,
  listAdminReports,
  updateAdminReport,
  listAdminMediaAudits,
  updateAdminMediaAudit,
  runAdminMediaAudit,
  listAdminMediaAuditRuns,
  getAdminMediaAuditRun,
  impersonateAdminUser,
  clearAdminImpersonation,
});

const UserRoutes = createUserRouter({
  getUserQuota,
  createUserReport,
  getUserPreferences,
  updateUserPreferences,
  listUserActivity,
  deleteUserActivity,
  trackUserActivity,
  deleteUserActivityByDate,
  deleteUserActivityById,
  getUserActivityHeatmap,
  getUserActivityStats,
  exportUserData,
  listUserLabs,
  enrollUserLab,
  unenrollUserLab,
});

// All /v1/user endpoints require session auth
router.use('/v1/user', requireSessionAuth);

router.use('/v1/search', ...searchAccess);
router.use('/v1/admin/impersonation', requireSessionAuth);
router.use('/v1/admin', requireApiKeyOrSession);
router.use('/v1/admin', enforceAdminAccess);
router.use('/v1/media', ...apiKeyOnly);
router.use('/v1/collections', requireSessionAuth);

router.get('/v1/media', ...mediaReadPermission);
router.get('/v1/media/*path', ...mediaReadPermission);
router.post('/v1/media/*path', ...mediaAddPermission);
router.patch('/v1/media/*path', ...mediaUpdatePermission);
router.delete('/v1/media/*path', ...mediaRemovePermission);

router.use('/', SearchRoutes);
router.use('/', MediaRoutes);
router.use('/', CollectionsRoutes);
router.use('/', AdminRoutes);
router.use('/', UserRoutes);

export { router, MediaRoutes, SearchRoutes, CollectionsRoutes, AdminRoutes, UserRoutes };
