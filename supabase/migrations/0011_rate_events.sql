-- 0011: Rate limiting events table.
-- Stores one row per paid-API invocation for sliding-window rate checks.

CREATE TABLE IF NOT EXISTS rate_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  route TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_rate_events_account_route_created
  ON rate_events (account_id, route, created_at DESC);

-- Cleanup: rows older than 1 hour are useless for rate limiting.
-- If pg_cron is available:
--   SELECT cron.schedule('rate_events_cleanup', '*/30 * * * *',
--     $$DELETE FROM rate_events WHERE created_at < NOW() - INTERVAL '1 hour'$$);
