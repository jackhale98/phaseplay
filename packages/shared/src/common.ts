import * as v from 'valibot';

export const Id = v.pipe(v.string(), v.uuid('Invalid id'));
export const Millis = v.pipe(v.number(), v.integer(), v.minValue(0));
export const IsoDate = v.pipe(v.string(), v.isoDate('Use YYYY-MM-DD'));
export const HHMM = v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'));
export const HexColor = v.pipe(v.string(), v.hexColor('Use a #RRGGBB colour'), v.length(7));

export function text(max: number, min = 0) {
  return v.pipe(
    v.string(),
    v.trim(),
    v.minLength(min, min === 1 ? 'Required' : `At least ${min} characters`),
    v.maxLength(max, `At most ${max} characters`),
  );
}

export const OptionalText = (max: number) => v.nullish(text(max), null);

export const Url = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(2000),
  v.url('Enter a full link, starting with https://'),
  v.check((s) => /^https?:\/\//i.test(s), 'Links must start with http(s)://'),
);

export const Timezone = v.pipe(
  v.string(),
  v.maxLength(64),
  v.check((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone'),
);

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'too_large'
  | 'rate_limited'
  | 'demo'
  | 'internal';

export type ApiError = { error: { code: ApiErrorCode; message: string; issues?: string[] } };

export const MAX_JSON_BYTES = 200 * 1024;
