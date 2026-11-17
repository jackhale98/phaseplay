/**
 * Drains `push_queue` in small batches. Workers Free allows 50 subrequests (each send is one),
 * 50 D1 queries and 10 ms CPU per invocation, so one drain sends at most `limit` messages:
 * a request starts the first batch with waitUntil, and the cron takes the rest.
 *
 * Cost per drain: 1 query to claim rows (with their devices), 0–1 for the VAPID key, 1 batch to
 * record the outcome.
 */
import { forgetJwt, vapidKeys } from './vapid';
import { sendPush } from './send';

/** Sends per invocation (each is a subrequest). */
// Each send costs ~0.5 ms CPU (ECDH + AES-GCM) against the 10 ms Free limit; a drain runs every minute.
export const DRAIN_LIMIT = 12;
/** Most devices one user receives on (newest first). */
const DEVICES_PER_USER = 5;
/** Claimed rows are hidden from other drains this long, in case this invocation dies. */
const LEASE_MS = 5 * 60e3;
/** Attempts per message before giving up, and the wait before each retry. */
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [60e3, 10 * 60e3, 60 * 60e3];
/** Older than this, a notification is no longer worth showing. */
const STALE_MS = 24 * 3600e3;
/** A device that keeps failing is dropped. */
export const MAX_DEVICE_FAILURES = 10;

type Claimed = {
  id: string;
  payload: string;
  attempts: number;
  created_at: number;
  subs: string;
};
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

export type DrainResult = { sent: number; failed: number; removed: number; claimed: number };

export async function drainQueue(
  db: D1Database,
  opts: { subject: string; secret?: string; limit?: number; now?: number; fetch?: typeof fetch },
): Promise<DrainResult> {
  const limit = opts.limit ?? DRAIN_LIMIT;
  const t = opts.now ?? Date.now();
  const { results: rows } = await db
    .prepare(
      `UPDATE push_queue SET next_at = ?1, attempts = attempts + 1
       WHERE id IN (SELECT id FROM push_queue WHERE next_at <= ?2 ORDER BY next_at LIMIT ?3)
       RETURNING id, payload, attempts - 1 AS attempts, created_at,
         (SELECT json_group_array(json_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
            FROM (SELECT * FROM push_subscriptions WHERE user_id = push_queue.user_id ORDER BY created_at DESC LIMIT ${DEVICES_PER_USER}) s) AS subs`,
    )
    .bind(t + LEASE_MS, t, limit)
    .all<Claimed>();
  const out: DrainResult = { sent: 0, failed: 0, removed: 0, claimed: rows.length };
  if (!rows.length) return out;
  rows.sort((a, b) => a.created_at - b.created_at);

  const done: string[] = [];
  const later: { id: string; a: number; n: number }[] = [];
  const work: { row: Claimed; subs: Sub[] }[] = [];
  let budget = limit;
  for (const row of rows) {
    const subs = JSON.parse(row.subs || '[]') as Sub[];
    // Counted at claim time, so an invocation killed mid-send (CPU limit) can't resend forever.
    if (!subs.length || row.created_at < t - STALE_MS || row.attempts >= MAX_ATTEMPTS)
      done.push(row.id);
    else if (subs.length <= budget || !work.length) {
      work.push({ row, subs: subs.slice(0, Math.max(budget, 1)) });
      budget -= subs.length;
    } else later.push({ id: row.id, a: row.attempts, n: t }); // next drain
  }

  const ok = new Set<string>();
  const failedSubs = new Set<string>();
  const gone = new Set<string>();
  if (work.length) {
    const vapid = await vapidKeys(db, opts.secret);
    await Promise.all(
      work.map(async ({ row, subs }) => {
        const res = await Promise.all(
          subs.map(async (s) => {
            const status = await sendPush(s, row.payload, {
              vapid,
              subject: opts.subject,
              fetch: opts.fetch,
            });
            if (status >= 200 && status < 300) ok.add(s.id);
            else if (status === 404 || status === 410) gone.add(s.id);
            else {
              failedSubs.add(s.id);
              if (status === 401 || status === 403) forgetJwt(s.endpoint);
            }
            return status;
          }),
        );
        const delivered = res.some((s) => s >= 200 && s < 300);
        // Busy or unreachable push service: try again later (unless it reached a device already).
        const transient = res.some((s) => s === 0 || s === 429 || s >= 500);
        if (delivered || !transient || row.attempts + 1 >= MAX_ATTEMPTS) done.push(row.id);
        else
          later.push({
            id: row.id,
            a: row.attempts + 1,
            n: t + BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length - 1)]!,
          });
      }),
    );
  }
  out.sent = ok.size;
  out.failed = failedSubs.size;
  out.removed = gone.size;

  const ids = (s: Iterable<string>) => JSON.stringify([...s]);
  const stmts: D1PreparedStatement[] = [];
  if (done.length)
    stmts.push(
      db
        .prepare('DELETE FROM push_queue WHERE id IN (SELECT value FROM json_each(?))')
        .bind(ids(done)),
    );
  if (later.length)
    stmts.push(
      db
        .prepare(
          `UPDATE push_queue SET attempts = j.value->>'a', next_at = j.value->>'n'
           FROM json_each(?) j WHERE push_queue.id = j.value->>'id'`,
        )
        .bind(JSON.stringify(later)),
    );
  if (gone.size)
    stmts.push(
      db
        .prepare('DELETE FROM push_subscriptions WHERE id IN (SELECT value FROM json_each(?))')
        .bind(ids(gone)),
    );
  if (ok.size)
    stmts.push(
      db
        .prepare(
          'UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE id IN (SELECT value FROM json_each(?))',
        )
        .bind(t, ids(ok)),
    );
  if (failedSubs.size)
    stmts.push(
      db
        .prepare(
          'UPDATE push_subscriptions SET failures = failures + 1 WHERE id IN (SELECT value FROM json_each(?))',
        )
        .bind(ids(failedSubs)),
      db
        .prepare(
          'DELETE FROM push_subscriptions WHERE failures >= ? AND id IN (SELECT value FROM json_each(?))',
        )
        .bind(MAX_DEVICE_FAILURES, ids(failedSubs)),
    );
  if (stmts.length) await db.batch(stmts);
  return out;
}
