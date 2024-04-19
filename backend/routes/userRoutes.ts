// @ts-nocheck
import express from "express";
export const router = express.Router();

import { authenticate } from "../middleware/authentication";
import { hasPermissionAPI } from "../middleware/permissionHandler";
import { signUp, logIn, logout, getUserInfo, loginGoogle, sendReportSegment } from "../controllers/userController";
import { listAPIKeysByUser, createAPIKeyDefault } from '../controllers/apiController'

// Post
router.post('/v1/jwt/user/info', authenticate({ jwt: true }), getUserInfo)
router.post('/v1/jwt/user/logout', authenticate({ jwt: true }), logout)
router.post("/v1/user/getApiKeys", authenticate({ jwt: true }), listAPIKeysByUser);
router.post("/v1/user/createApiKey", authenticate({ jwt: true }), createAPIKeyDefault);
router.post("/v1/user/login", authenticate({ apiKey: true }), logIn);
router.post("/v1/user/login/google", authenticate({ apiKey: true }), loginGoogle)
router.post("/v1/user/register", authenticate({ apiKey: true }), hasPermissionAPI(['CREATE_USER']), signUp);
