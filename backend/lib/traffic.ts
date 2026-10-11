/** Re-export shared traffic classification so `@lib/traffic` remains stable; backend/frontend copies come from one
 * workspace package because builds cannot import across the boundary. */
export * from '@brigadasos/nadeshiko-shared/traffic';
