import type { ZodTypeAny } from 'zod/v4';

function formatIssues(issues: Array<{ path: Array<string | number>; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `- ${path}: ${issue.message}`;
    })
    .join('\n');
}

export function assertMatchesSchema(schema: ZodTypeAny, payload: unknown, context: string): void {
  const result = schema.safeParse(payload);
  if (result.success) {
    return;
  }

  throw new Error(
    `[OpenAPI contract] ${context} response failed schema validation:\n${formatIssues(result.error.issues)}`,
  );
}
