-- Configurable base roles (PLAN.md §2). Additive only. NULL = today's defaults; otherwise a JSON
-- object {coach, manager, player} of each role's full configurable set (RolePermissionsInput in
-- packages/shared, normalised on write). role_permissions_at forces members' next sync to be full and is the
-- If-Match version for the settings editor (NULL = never changed = version 1).
ALTER TABLE teams ADD COLUMN role_permissions TEXT;
ALTER TABLE teams ADD COLUMN role_permissions_at INTEGER;
