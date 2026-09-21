-- Manually approved additive production allowance. Never applied at startup.
-- 0001 remains immutable. This changes no existing rows or delivery state.
BEGIN;
ALTER TABLE ema_ghl_operations DROP CONSTRAINT ema_ghl_operations_environment_check;
ALTER TABLE ema_ghl_operations ADD CONSTRAINT ema_ghl_operations_environment_check
  CHECK (environment IN ('development','test','production'));
ALTER TABLE ema_ghl_links DROP CONSTRAINT ema_ghl_links_environment_check;
ALTER TABLE ema_ghl_links ADD CONSTRAINT ema_ghl_links_environment_check
  CHECK (environment IN ('development','test','production'));
COMMIT;