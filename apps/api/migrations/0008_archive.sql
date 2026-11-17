-- Archive plays and drills (hidden from lists, still usable where referenced), and hide built-in
-- drill templates / play presets per team. Additive.
ALTER TABLE plays ADD COLUMN archived_at INTEGER;
ALTER TABLE drills ADD COLUMN archived_at INTEGER;
ALTER TABLE teams ADD COLUMN hidden_templates TEXT NOT NULL DEFAULT '[]';
