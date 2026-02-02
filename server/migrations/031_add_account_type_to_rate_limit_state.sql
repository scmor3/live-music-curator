-- Update rate_limit_state table to support multiple accounts (primary and backup)
-- This allows us to maintain separate rate limit state for each Spotify account

-- First, drop the single-row constraint if it exists
ALTER TABLE rate_limit_state DROP CONSTRAINT IF EXISTS single_row;

-- Add account_type column (1 = primary, 2 = backup)
-- If column already exists, this will be a no-op
ALTER TABLE rate_limit_state ADD COLUMN IF NOT EXISTS account_type INTEGER;

-- Set default value for existing rows (migrate old data to primary account)
UPDATE rate_limit_state SET account_type = 1 WHERE account_type IS NULL;

-- Make account_type NOT NULL with default
ALTER TABLE rate_limit_state ALTER COLUMN account_type SET DEFAULT 1;
ALTER TABLE rate_limit_state ALTER COLUMN account_type SET NOT NULL;

-- Create unique constraint on account_type (only one row per account type)
-- This replaces the old single-row constraint
ALTER TABLE rate_limit_state DROP CONSTRAINT IF EXISTS rate_limit_state_account_type_unique;
ALTER TABLE rate_limit_state ADD CONSTRAINT rate_limit_state_account_type_unique UNIQUE (account_type);

-- Update index to include account_type for faster lookups
DROP INDEX IF EXISTS idx_rate_limit_expires_at;
CREATE INDEX IF NOT EXISTS idx_rate_limit_expires_at_account_type ON rate_limit_state(rate_limit_expires_at, account_type);

-- Note: We keep the 'id' column for backwards compatibility, but account_type is now the unique identifier
