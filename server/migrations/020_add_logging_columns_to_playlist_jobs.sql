-- Purpose: Adds columns to the playlist_jobs table to support the Live Activity Feed.
-- 'log_history' will store an ordered array of status messages (e.g. "Scanning...", "Found artist X").
-- 'total_artists' and 'processed_artists' are used to calculate the progress bar percentage.

ALTER TABLE public.playlist_jobs
ADD COLUMN log_history text[] DEFAULT '{}',
ADD COLUMN total_artists integer DEFAULT 0,
ADD COLUMN processed_artists integer DEFAULT 0;