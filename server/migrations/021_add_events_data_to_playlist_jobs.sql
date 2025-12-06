-- Purpose: Adds 'events_data' column to playlist_jobs to store rich event details 
-- (venue, ticket links, date, image) for the Concert List UI.
-- Using JSONB allows us to store the array of event objects flexibly without a new table.

ALTER TABLE public.playlist_jobs
ADD COLUMN events_data JSONB DEFAULT '[]';