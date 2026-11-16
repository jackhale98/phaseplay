/** Same-origin JSON API client. Errors carry the server's code and (for 409) the latest copy. */
import type { ApiErrorCode } from '@phaseplay/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode | 'network',
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get retryable() {
    return this.code === 'network' || this.status >= 500 || this.status === 429;
  }
}

export type ReqInit = {
  method?: string;
  body?: unknown;
  ifMatch?: number | null;
  signal?: AbortSignal;
};

export async function api<T = unknown>(path: string, init: ReqInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.ifMatch) headers['if-match'] = String(init.ifMatch);
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', "You're offline. We'll sync when you're back.");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: ApiErrorCode; message?: string } } | null)?.error;
    const { code: _c, message: _m, ...extra } = (err ?? {}) as Record<string, unknown>;
    throw new ApiError(
      res.status,
      err?.code ?? 'internal',
      err?.message ?? `Request failed (${res.status})`,
      extra,
    );
  }
  return data as T;
}

export const v1 = (p: string) => `/api/v1${p}`;
