-- What players see of each other's replies: 'counts' (default), 'games' or 'all'. Additive.
ALTER TABLE teams ADD COLUMN rsvp_visibility TEXT NOT NULL DEFAULT 'counts';
