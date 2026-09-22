-- Additive, reviewed deployment migration; no startup migration or lead uniqueness changes.
BEGIN;
CREATE TABLE ema_intake_receipts (
  attempt_id uuid PRIMARY KEY,
  flow text NOT NULL CHECK (flow IN ('individual','overstay','business')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  lead_id uuid NOT NULL REFERENCES prelaunch_leads(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;