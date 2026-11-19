-- Uploaded images for the playbook (additive): picture-play pages and drill photos. Bytes live in
-- D1 like team emblems (resized/re-encoded in the browser, magic bytes checked, metadata stripped);
-- the owning row's `media` JSON carries the ordered metadata so sync never sends bytes.
-- Metadata and bytes are separate tables so listing, counting and serving a thumbnail never read
-- a full image. Deleting an image removes its bytes at once and leaves a small tombstone row.
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('play', 'drill')),
  owner_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  -- Stored bytes of the image and of its thumbnail (0 when none), for quotas and the global total.
  size INTEGER NOT NULL,
  thumb_size INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX media_owner ON media(team_id, owner_type, owner_id, position);
CREATE INDEX media_live ON media(team_id) WHERE deleted_at IS NULL;
CREATE INDEX media_deleted ON media(deleted_at) WHERE deleted_at IS NOT NULL;
-- Per-person upload rate (rows in the last hour, tombstones included).
CREATE INDEX media_uploader ON media(created_by, created_at);
-- One row per image ('full') and per thumbnail ('thumb'); type is the sniffed type.
CREATE TABLE media_blobs (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('full', 'thumb')),
  type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (media_id, kind)
);
-- Running total of stored image bytes (all teams), kept by the triggers below and recomputed
-- nightly; uploads past MEDIA_GLOBAL_BYTES are refused.
INSERT OR IGNORE INTO app_meta (key, value, updated_at) VALUES ('media_bytes', '0', 0);
CREATE TRIGGER media_bytes_add AFTER INSERT ON media WHEN NEW.deleted_at IS NULL
BEGIN
  UPDATE app_meta SET value = CAST(value AS INTEGER) + NEW.size + NEW.thumb_size
  WHERE key = 'media_bytes';
END;
-- Deleting an image (tombstoning its row) frees its bytes at once.
CREATE TRIGGER media_bytes_remove AFTER UPDATE OF deleted_at ON media
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE app_meta SET value = max(0, CAST(value AS INTEGER) - OLD.size - OLD.thumb_size)
  WHERE key = 'media_bytes';
  DELETE FROM media_blobs WHERE media_id = OLD.id;
END;
-- 'diagram' (animated) or 'picture' (uploaded pages). Existing plays stay diagrams.
ALTER TABLE plays ADD COLUMN kind TEXT NOT NULL DEFAULT 'diagram';
ALTER TABLE plays ADD COLUMN media TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drills ADD COLUMN media TEXT NOT NULL DEFAULT '[]';
