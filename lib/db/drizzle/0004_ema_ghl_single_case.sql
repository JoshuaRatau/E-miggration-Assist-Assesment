-- Additive person/case registry. Existing conflicting mappings fail closed.
BEGIN;
ALTER TABLE ema_ghl_operations DROP CONSTRAINT ema_ghl_operations_kind_check;
ALTER TABLE ema_ghl_operations ADD CONSTRAINT ema_ghl_operations_kind_check
  CHECK (kind IN ('contact','contact_verify','history','history_verify','opportunity','opportunity_verify','opportunity_reuse'));
ALTER TABLE ema_ghl_operations DROP CONSTRAINT ema_ghl_operations_state_check;
ALTER TABLE ema_ghl_operations ADD CONSTRAINT ema_ghl_operations_state_check
  CHECK (state IN ('pending','running','retry','confirmed','review','blocked','cancelled'));
CREATE TABLE ema_ghl_cases (
  environment text NOT NULL,
  location_id text NOT NULL,
  contact_id text NOT NULL,
  opportunity_id text NOT NULL,
  PRIMARY KEY(environment,location_id,contact_id),
  UNIQUE(environment,location_id,opportunity_id),
  UNIQUE(environment,location_id,contact_id,opportunity_id)
);
INSERT INTO ema_ghl_cases(environment,location_id,contact_id,opportunity_id)
  SELECT DISTINCT environment,location_id,contact_id,opportunity_id
  FROM ema_ghl_links WHERE opportunity_id IS NOT NULL;
DROP INDEX ema_ghl_opportunity_owner;
CREATE INDEX ema_ghl_opportunity_owner ON ema_ghl_links(environment,location_id,opportunity_id)
  WHERE opportunity_id IS NOT NULL;
ALTER TABLE ema_ghl_links ADD CONSTRAINT ema_ghl_links_case_fk
  FOREIGN KEY(environment,location_id,contact_id,opportunity_id)
  REFERENCES ema_ghl_cases(environment,location_id,contact_id,opportunity_id);
COMMIT;