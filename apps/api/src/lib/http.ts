import type { Context } from 'hono';
import * as v from 'valibot';
import type { ApiErrorCode } from '@phaseplay/shared';
import type { AppEnv } from '../env';

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 429 | 500,
    public code: ApiErrorCode,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const forbidden = (msg = "You don't have permission to do that") =>
  new HttpError(403, 'forbidden', msg);
export const badRequest = (msg: string, issues?: string[]) =>
  new HttpError(400, 'bad_request', msg, issues ? { issues } : undefined);

const MAX_BODY = 320 * 1024;

/** Read and validate a JSON body with a shared valibot schema. */
export async function body<S extends v.GenericSchema>(
  c: Context<AppEnv>,
  schema: S,
): Promise<v.InferOutput<S>> {
  const ct = c.req.header('content-type') ?? '';
  if (!ct.toLowerCase().startsWith('application/json'))
    throw new HttpError(415, 'bad_request', 'Expected application/json');
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, 'too_large', 'Request is too large');
  const text = await c.req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large', 'Request is too large');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('Invalid JSON');
  }
  const r = v.safeParse(schema, json);
  if (!r.success) {
    const issues = r.issues.map((i) => {
      const path = i.path?.map((p) => String(p.key)).join('.');
      return path ? `${path}: ${i.message}` : i.message;
    });
    throw badRequest(issues[0] ?? 'Invalid request', issues);
  }
  return r.output;
}

/** Parse `If-Match: <version>` (quotes optional). */
export function ifMatch(c: Context<AppEnv>): number | null {
  const h = c.req.header('if-match');
  if (!h) return null;
  const n = Number(h.replace(/^W\//, '').replace(/"/g, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function json<T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) {
  return c.json(data as object, status);
}

export const now = () => Date.now();

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (s === null || s === undefined || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
