export const locales: string[];
export function readPublished(dir: string): Promise<unknown>;
export function validateXml(body: string, locale?: string): void;
export function publishSnapshot(
  dir: string,
  generate: () => Promise<Record<string, string>>,
  options?: { refresh?: boolean },
): Promise<{ reused: boolean; manifest?: unknown }>;
export function generateIsolated(options?: { entry?: string }): Promise<Record<string, string>>;
