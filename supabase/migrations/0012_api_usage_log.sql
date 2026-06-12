-- 0012: API usage log for cost monitoring.
-- One row per external paid-API call with estimated cost and status.

CREATE TABLE IF NOT EXISTS api_usage_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  provider TEXT NOT NULL,
  route TEXT NOT NULL,
  cost_usd_est NUMERIC(10,4) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  error_msg TEXT
);

CREATE INDEX idx_api_usage_log_provider_created
  ON api_usage_log (provider, created_at DESC);

CREATE INDEX idx_api_usage_log_account_created
  ON api_usage_log (account_id, created_at DESC);
