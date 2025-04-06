// @ts-nocheck
import express from "express";
export const router = express.Router();

import { authenticate } from "../middleware/authentication";
import { hasPermissionAPI } from "../middleware/permissionHandler";
import { signUp, logIn, logout, getUserInfo, loginGoogle, getDiscordAuthUrl, loginDiscord, sendReportSegment } from "../controllers/userController";
import { listAPIKeysByUser, createAPIKeyDefault, deactivateAPIKey } from '../controllers/apiController'

// Post
router.post('/v1/jwt/user/info', authenticate({ jwt: true }), getUserInfo)
router.post("/v1/user/getApiKeys", authenticate({ jwt: true }), listAPIKeysByUser);
router.post("/v1/user/createApiKey", authenticate({ jwt: true }), createAPIKeyDefault);
router.post("/v1/user/deactivateApiKey", authenticate({ jwt: true }), deactivateAPIKey);


router.post("/v1/auth/login", authenticate({ apiKey: true }), logIn);
router.post("/v1/auth/google", authenticate({ apiKey: true }), loginGoogle)

router.post("/v1/auth/discord", loginDiscord);
router.get('/v1/auth/discord/url', getDiscordAuthUrl);

router.post("/v1/auth/register", authenticate({ apiKey: true }), hasPermissionAPI(['CREATE_USER']), signUp);
router.post('/v1/auth/logout', authenticate({ jwt: true }), logout)
router.get('/v1/auth/identity/me', authenticate({ jwt: true }), getUserInfo)
