type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type AuthApiRequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
};

export type AuthApiResponse<T> = {
  status: number;
  ok: boolean;
  data: T | null;
};

async function parseResponseData<T>(response: Response): Promise<T | null> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const text = await response.text();
    if (!text) {
      return null;
    }

    return JSON.parse(text) as T;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return text as unknown as T;
}

export async function authApiRequest<T = unknown>(
  path: string,
  options: AuthApiRequestOptions = {},
): Promise<AuthApiResponse<T>> {
  const headers = new Headers(options.headers);
  const method: HttpMethod = options.method ?? (options.body !== undefined ? 'POST' : 'GET');

  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const contentType = headers.get('Content-Type') || '';

    body = contentType.includes('application/json') ? JSON.stringify(options.body) : (options.body as BodyInit);
  }

  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body,
  });

  const data = await parseResponseData<T>(response);

  return {
    status: response.status,
    ok: response.ok,
    data,
  };
}
