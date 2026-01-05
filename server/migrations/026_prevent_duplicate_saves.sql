
-- Add a unique constraint
-- This ensures the database will throw an error if we try to save the same job twice.
ALTER TABLE saved_playlists
ADD CONSTRAINT unique_user_job UNIQUE (user_id, original_job_id);