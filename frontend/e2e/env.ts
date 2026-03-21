export function getE2EBaseUrl(fallback?: string): string {
  const baseUrl = process.env.E2E_BASE_URL || process.env.BASE_URL || fallback;

  if (!baseUrl) {
    throw new Error('E2E_BASE_URL or BASE_URL must be set (loaded from backend/.env)');
  }

  return baseUrl;
}
