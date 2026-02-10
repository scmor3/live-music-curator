-- Purpose: Make playlist_id nullable in email_requests table
-- This is necessary because when a user requests an email for a playlist that's still building,
-- we don't have the playlist_id yet. It will be set when the playlist is created.

-- Make playlist_id nullable (idempotent - safe to run multiple times)
DO $$
BEGIN
  -- Check if column is currently NOT NULL
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'email_requests' 
    AND column_name = 'playlist_id' 
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE email_requests
    ALTER COLUMN playlist_id DROP NOT NULL;
  END IF;
END $$;
