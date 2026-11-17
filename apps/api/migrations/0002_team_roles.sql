-- Team roles (Captain, Treasurer…), admins and ownership handover. Additive only.

-- Named bundles of extra permissions, defined per team and assigned to members.
CREATE TABLE team_roles (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX team_roles_team_updated ON team_roles(team_id, updated_at);

-- Team role ids assigned to a member (JSON array).
ALTER TABLE memberships ADD COLUMN role_ids TEXT NOT NULL DEFAULT '[]';

-- Ownership handover: the nominated member until they accept or decline.
ALTER TABLE teams ADD COLUMN pending_owner_member_id TEXT;
ALTER TABLE teams ADD COLUMN pending_owner_at INTEGER;

-- Last time the user was seen signing in/out (sessions also record activity), so an admin can
-- take over a team whose owner has disappeared.
ALTER TABLE users ADD COLUMN last_seen_at INTEGER;
