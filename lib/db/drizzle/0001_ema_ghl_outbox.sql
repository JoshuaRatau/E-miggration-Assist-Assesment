-- Additive, manually reviewed migration. NOT applied automatically or by this change.
-- Apply with a controlled migration runner, once, after backup and isolation checks.
BEGIN;
CREATE TABLE ema_assessment_submissions (
  id uuid PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES prelaunch_leads(id),
  flow text NOT NULL CHECK (flow IN ('individual','overstay','business')),
  answers jsonb NOT NULL,
  attribution jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (lead_id)
);
CREATE FUNCTION ema_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
    OR NEW.flow IS DISTINCT FROM OLD.flow OR NEW.answers IS DISTINCT FROM OLD.answers
    OR NEW.attribution IS DISTINCT FROM OLD.attribution OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
    OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
  THEN RAISE EXCEPTION 'immutable assessment snapshot'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ema_snapshot_immutable BEFORE UPDATE ON ema_assessment_submissions
FOR EACH ROW EXECUTE FUNCTION ema_snapshot_immutable();
CREATE TABLE ema_ghl_operations (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES ema_assessment_submissions(id),
  environment text NOT NULL CHECK(environment IN ('development','test')),
  location_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('contact','contact_verify','history','history_verify','opportunity','opportunity_verify')),
  ordinal integer NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','retry','confirmed','review','blocked')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  remote_id text,
  result jsonb,
  error_code text,
  confirmed_at timestamptz,
  UNIQUE(submission_id, environment, location_id, kind)
);
CREATE INDEX ema_ghl_ready ON ema_ghl_operations(state,available_at);
CREATE TABLE ema_ghl_attempts (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES ema_ghl_operations(id),
  action text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'started',
  http_status integer,
  error_code text
);
CREATE TABLE ema_ghl_links (
  environment text NOT NULL CHECK(environment IN ('development','test')),
  location_id text NOT NULL,
  lead_id uuid NOT NULL REFERENCES prelaunch_leads(id),
  contact_id text,
  opportunity_id text,
  latest_completed_at timestamptz,
  PRIMARY KEY(environment,location_id,lead_id)
);
CREATE UNIQUE INDEX ema_ghl_opportunity_owner ON ema_ghl_links(environment,location_id,opportunity_id)
WHERE opportunity_id IS NOT NULL;
-- Global per-location lease: deliberately serialises identity resolution and writes,
-- including different EMA leads sharing a remote identity. Prefer safety over throughput.
CREATE TABLE ema_ghl_worker_leases (
  scope text PRIMARY KEY,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
-- An unresolved remote mutation blocks ALL other operations in that scope.
-- A timed-out PUT requires operator review: local fencing cannot cancel a late remote write.
CREATE TABLE ema_ghl_mutation_barriers (
  scope text PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES ema_ghl_operations(id),
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;