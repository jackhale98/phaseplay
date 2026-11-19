-- "Time TBD": games and events (never practices) with a date but no time yet. Additive only.
-- starts_at then holds local noon of that date in the team's timezone (the date never shifts
-- across zones or DST); meet_at and ends_at are null. A TBD event runs until the end of its day.
ALTER TABLE events ADD COLUMN time_tbd INTEGER NOT NULL DEFAULT 0;
-- Each date of a proposal can be TBD too; confirming a TBD date keeps it TBD unless a time is set.
ALTER TABLE event_options ADD COLUMN time_tbd INTEGER NOT NULL DEFAULT 0;
