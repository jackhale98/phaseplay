-- Uploaded images for the playbook (additive): picture-play pages and drill photos. Bytes live in
-- D1 like team emblems (resized/re-encoded in the browser, magic bytes checked, metadata stripped);
-- the owning row's `media` JSON carries the ordered metadata so sync never sends bytes.
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('play', 'drill')),
  owner_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  thumb_type TEXT,
  thumb BLOB,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX media_owner ON media(team_id, owner_type, owner_id, position);
CREATE INDEX media_live ON media(team_id) WHERE deleted_at IS NULL;
CREATE INDEX media_deleted ON media(deleted_at) WHERE deleted_at IS NOT NULL;
-- 'diagram' (animated) or 'picture' (uploaded pages). Existing plays stay diagrams.
ALTER TABLE plays ADD COLUMN kind TEXT NOT NULL DEFAULT 'diagram';
ALTER TABLE plays ADD COLUMN media TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drills ADD COLUMN media TEXT NOT NULL DEFAULT '[]';
