-- Up
ALTER TABLE playlist_jobs 
ADD COLUMN max_start_time integer DEFAULT 24;