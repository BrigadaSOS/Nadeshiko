const GITHUB_ISSUES_URL = 'https://github.com/BrigadaSOS/Nadeshiko/issues/new?template=bug_report.yml';

interface ErrorResponse {
  code: string;
  title: string;
  detail: string;
  type: string;
  status: number;
  instance?: string;
  errors?: Record<string, string>;
}

export abstract class ApiError extends Error {
  abstract readonly code: string;
  abstract readonly title: string;
  abstract readonly status: number;
  readonly type: string = GITHUB_ISSUES_URL;
  instance?: string;
  protected errors?: Record<string, string>;

  constructor(detail: string) {
    super(detail);
    this.name = this.constructor.name;
  }

  toJSON(): ErrorResponse {
    const response: ErrorResponse = {
      code: this.code,
      title: this.title,
      detail: this.message,
      type: this.type,
      status: this.status,
    };

    if (this.instance) {
      response.instance = this.instance;
    }

    if (this.errors) {
      response.errors = this.errors;
    }

    return response;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
