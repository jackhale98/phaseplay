-- One calendar link per team that every member can subscribe to (schedules aren't sensitive).
-- Stored as is (not hashed) so the app can show it to members any time; staff can reset it.
ALTER TABLE teams ADD COLUMN calendar_token TEXT;
CREATE UNIQUE INDEX teams_calendar_token ON teams(calendar_token) WHERE calendar_token IS NOT NULL;
