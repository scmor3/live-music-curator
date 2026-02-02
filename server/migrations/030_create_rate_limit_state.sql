-- Create table to persist Spotify rate limit state across server restarts
-- This prevents making requests immediately after restart if we were rate limited

CREATE TABLE IF NOT EXISTS rate_limit_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  rate_limit_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Create index for quick lookup
CREATE INDEX IF NOT EXISTS idx_rate_limit_expires_at ON rate_limit_state(rate_limit_expires_at);
