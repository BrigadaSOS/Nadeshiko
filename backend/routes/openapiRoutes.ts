import express from 'express';
import path from 'path';

export const router = express.Router();

/**
 * Serves the OpenAPI specification file
 */
router.get('/v1/openapi.yaml', (_req, res) => {
  res.setHeader('Content-Type', 'application/x-yaml');
  res.sendFile(path.join(__dirname, '../openapi/nadeshikoapi.yaml'));
});
