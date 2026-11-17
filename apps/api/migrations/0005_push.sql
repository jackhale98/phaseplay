-- Web Push (M7). Additive only.
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,                 -- sha-256 of the endpoint
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);

-- Outgoing notifications, drained in small batches (Workers Free allows 50 subrequests and
-- 10 ms CPU per invocation): first batch right away, the rest by the cron.
CREATE TABLE push_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL
);
CREATE INDEX push_queue_next ON push_queue(next_at);

-- Server-generated keys (the VAPID key pair), created on first use so no secret setup is needed.
CREATE TABLE server_keys (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

ALTER TABLE users ADD COLUMN notify_prefs TEXT NOT NULL DEFAULT '{}';
-- When the day-before reply reminder went out for an event.
ALTER TABLE events ADD COLUMN reminded_at INTEGER;
