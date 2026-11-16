-- Phaseplay initial schema. IDs are UUIDv7 text; timestamps are INTEGER ms UTC.
-- Migrations are forward-only and expand/contract (docs/testing-ci.md §Deploy).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  device_type TEXT,
  nickname TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX credentials_user ON credentials(user_id);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL,
  user_id TEXT,
  data TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_challenges_expires ON auth_challenges(expires_at);

CREATE TABLE recovery_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX recovery_codes_user ON recovery_codes(user_id);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  colors TEXT NOT NULL,
  default_format TEXT NOT NULL,
  timezone TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

-- A membership has its own id so pending (imported) names can be picked on sheets and
-- RSVP'd for by coaches before the player joins; claiming sets user_id.
CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  jersey INTEGER,
  positions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  joined_at INTEGER,
  removed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX memberships_team_user ON memberships(team_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX memberships_user ON memberships(user_id, status);
CREATE INDEX memberships_team_status ON memberships(team_id, status);
CREATE INDEX memberships_team_updated ON memberships(team_id, updated_at);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  role TEXT NOT NULL,
  target_member_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);
CREATE INDEX invites_team ON invites(team_id, created_at);

CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX seasons_team_updated ON seasons(team_id, updated_at);

CREATE TABLE recurrences (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  template TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX recurrences_team ON recurrences(team_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id TEXT,
  type TEXT NOT NULL,
  format TEXT,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  meet_at INTEGER,
  ends_at INTEGER,
  location_name TEXT,
  location_url TEXT,
  opponent TEXT,
  notes TEXT,
  rsvp_deadline INTEGER,
  recurrence_id TEXT,
  cancelled_at INTEGER,
  settings TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX events_team_starts ON events(team_id, starts_at);
CREATE INDEX events_team_updated ON events(team_id, updated_at);
CREATE INDEX events_recurrence ON events(recurrence_id);

CREATE TABLE rsvps (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  status TEXT,
  note TEXT,
  note_expires_at INTEGER,
  attended INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, member_id)
);
CREATE INDEX rsvps_team_updated ON rsvps(team_id, updated_at);
CREATE INDEX rsvps_member ON rsvps(member_id);
CREATE INDEX rsvps_note_expires ON rsvps(note_expires_at) WHERE note_expires_at IS NOT NULL;

CREATE TABLE team_sheets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  format TEXT NOT NULL,
  replacements INTEGER NOT NULL,
  slots TEXT NOT NULL,
  captain_id TEXT,
  vice_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  -- Snapshot of the last published sheet; players only ever see this.
  published TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  published_at INTEGER,
  created_by TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX team_sheets_event ON team_sheets(event_id);
CREATE INDEX team_sheets_team_updated ON team_sheets(team_id, updated_at);

CREATE TABLE team_sheet_versions (
  sheet_id TEXT NOT NULL REFERENCES team_sheets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sheet_id, version)
);

CREATE TABLE plays (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  format TEXT NOT NULL,
  visibility TEXT NOT NULL,
  description TEXT,
  data TEXT NOT NULL,
  frame_count INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX plays_team_updated ON plays(team_id, updated_at);
CREATE INDEX plays_team_category ON plays(team_id, category);

CREATE TABLE play_views (
  play_id TEXT NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  day TEXT NOT NULL,
  first_viewed_at INTEGER NOT NULL,
  PRIMARY KEY (play_id, member_id, day)
);

CREATE TABLE drills (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  contact_level TEXT NOT NULL,
  intensity INTEGER NOT NULL,
  players_min INTEGER NOT NULL,
  players_max INTEGER NOT NULL,
  area TEXT NOT NULL,
  equipment TEXT NOT NULL DEFAULT '{}',
  default_duration_min INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  coaching_points TEXT NOT NULL DEFAULT '[]',
  setup TEXT NOT NULL DEFAULT '',
  variations TEXT NOT NULL DEFAULT '[]',
  diagram TEXT,
  visibility TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'team',
  parent_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX drills_team_updated ON drills(team_id, updated_at);
CREATE INDEX drills_team_category ON drills(team_id, category);

CREATE TABLE practice_plans (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id TEXT,
  title TEXT NOT NULL,
  is_template INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'team',
  blocks TEXT NOT NULL,
  planned_total_min INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX practice_plans_team_updated ON practice_plans(team_id, updated_at);
CREATE INDEX practice_plans_event ON practice_plans(event_id);

CREATE TABLE practice_runs (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES practice_plans(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX practice_runs_plan ON practice_runs(plan_id, at);

CREATE TABLE match_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  game_ms INTEGER NOT NULL,
  wall_at INTEGER NOT NULL,
  supersedes_id TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX match_events_event ON match_events(event_id, wall_at);
CREATE INDEX match_events_team_created ON match_events(team_id, created_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  meta TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX audit_log_team_at ON audit_log(team_id, at);

CREATE TABLE calendar_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id TEXT,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX calendar_tokens_user ON calendar_tokens(user_id);
