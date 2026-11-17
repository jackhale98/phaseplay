-- Uploaded team emblems (additive). Small raster images (<= 200 KB, resized in the browser) live in
-- D1; teams.crest_version changes on every upload so the image URL can be cached forever.
CREATE TABLE team_crests (
  team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
ALTER TABLE teams ADD COLUMN crest_version INTEGER;
