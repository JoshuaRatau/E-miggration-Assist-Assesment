-- Additive operation-journal diagnostics. Manually reviewed/applied; never run at startup.
-- provider_response is populated only after strict application-layer redaction.
BEGIN;
ALTER TABLE ema_ghl_attempts
  ADD COLUMN provider_response jsonb,
  ADD COLUMN correlation_id text,
  ADD COLUMN correlation_source text,
  ADD COLUMN provider_failure_reason text,
  ADD COLUMN classification_source text;
ALTER TABLE ema_ghl_attempts
  ADD CONSTRAINT ema_ghl_attempts_correlation_id_check
    CHECK (correlation_id IS NULL OR
      (length(correlation_id) BETWEEN 8 AND 128
        AND correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
        AND correlation_id ~ '[A-Za-z]' AND correlation_id ~ '[0-9]' AND correlation_id ~ '[._:-]')),
  ADD CONSTRAINT ema_ghl_attempts_correlation_source_check
    CHECK (correlation_source IS NULL OR correlation_source IN
      ('response-header:x-request-id','response-header:x-correlation-id','body.traceId')),
  ADD CONSTRAINT ema_ghl_attempts_provider_failure_reason_check
    CHECK (provider_failure_reason IS NULL OR provider_failure_reason = 'DUPLICATE_OPPORTUNITY'),
  ADD CONSTRAINT ema_ghl_attempts_classification_source_check
    CHECK (classification_source IS NULL OR classification_source = 'sanitizer:exact-message-allowlist');
COMMIT;