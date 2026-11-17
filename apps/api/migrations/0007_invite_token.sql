-- Keep the join-link secret so staff can copy an active invite again (additive).
-- Relink (device recovery) invites never store it. Older invites stay hash-only.
ALTER TABLE invites ADD COLUMN token TEXT;
