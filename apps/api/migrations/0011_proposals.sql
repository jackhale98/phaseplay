-- Tentative games and events ("Not confirmed yet"). Additive only.
-- A proposal is a normal game or event whose status is 'proposed'. Its candidate dates live in
-- event_options (one row = a tentative item, 2–4 = a date poll); members answer per date.
ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'; -- confirmed | proposed | dropped
ALTER TABLE events ADD COLUMN answer_by INTEGER;
-- Players needed (null = the team's default for the format).
ALTER TABLE events ADD COLUMN target INTEGER;
-- Check front-row cover for each date (games).
ALTER TABLE events ADD COLUMN check_positions INTEGER NOT NULL DEFAULT 1;
-- The date a proposal was confirmed for (retries of the same confirm are no-ops).
ALTER TABLE events ADD COLUMN confirmed_option_id TEXT;
-- When the "answer by" reminder went out (once per proposal).
ALTER TABLE events ADD COLUMN proposal_reminded_at INTEGER;
-- The reminder cron looks proposals up by answer-by time.
CREATE INDEX events_proposed_answer_by ON events(answer_by) WHERE status = 'proposed';

CREATE TABLE event_options (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,
  meet_at INTEGER,
  ends_at INTEGER,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX event_options_team_updated ON event_options(team_id, updated_at);
CREATE INDEX event_options_event ON event_options(event_id);

CREATE TABLE proposal_answers (
  option_id TEXT NOT NULL REFERENCES event_options(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL,
  answer TEXT NOT NULL, -- in | cant
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (option_id, member_id)
);
CREATE INDEX proposal_answers_team_updated ON proposal_answers(team_id, updated_at);
CREATE INDEX proposal_answers_event ON proposal_answers(event_id);
CREATE INDEX proposal_answers_member ON proposal_answers(member_id);

-- Confirmed from a proposal: a "yes" that still needs a "Still in?" from the player.
ALTER TABLE rsvps ADD COLUMN reconfirm INTEGER NOT NULL DEFAULT 0;

-- Default "players needed" for proposals, per format.
ALTER TABLE teams ADD COLUMN proposal_target_15s INTEGER NOT NULL DEFAULT 20;
ALTER TABLE teams ADD COLUMN proposal_target_7s INTEGER NOT NULL DEFAULT 10;
