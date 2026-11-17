-- Kit and inventory (M9). Additive only.
CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  tag TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  condition TEXT NOT NULL DEFAULT 'good',
  status TEXT NOT NULL DEFAULT 'available',
  holder_member_id TEXT,
  home TEXT,
  notes TEXT,
  match_day INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX inventory_items_team ON inventory_items(team_id, updated_at);
CREATE INDEX inventory_items_holder ON inventory_items(holder_member_id);
CREATE UNIQUE INDEX inventory_items_tag ON inventory_items(team_id, tag) WHERE tag IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE inventory_events (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_member_id TEXT,
  from_member_id TEXT,
  to_member_id TEXT,
  note TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX inventory_events_item ON inventory_events(item_id, at);

CREATE TABLE inventory_handoffs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  from_member_id TEXT,
  to_member_id TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER,
  outcome TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX inventory_handoffs_team ON inventory_handoffs(team_id, updated_at);
-- One open handover per item.
CREATE UNIQUE INDEX inventory_handoffs_open ON inventory_handoffs(item_id) WHERE resolved_at IS NULL;
