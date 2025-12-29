-- Purpose: Add an owner_id column to link playlists to Supabase users (anon or auth).
-- We allow NULL values so existing historical jobs don't cause the migration to fail.

ALTER TABLE public.playlist_jobs
ADD COLUMN owner_id UUID REFERENCES auth.users(id);

-- Create an index on this column so fetching "My Playlists" is fast later.
CREATE INDEX idx_playlist_jobs_owner_id ON public.playlist_jobs(owner_id);