-- Purpose: Add original_job_id column to playlist_jobs table
-- This column tracks the relationship between update jobs and their original jobs.
-- For update jobs: references the original job that created the playlist.
-- For original jobs: NULL (they don't have an original job).

-- Add column (nullable, since original jobs don't have this)
ALTER TABLE public.playlist_jobs
ADD COLUMN original_job_id BIGINT REFERENCES public.playlist_jobs(id) ON DELETE SET NULL;

-- Add index for performance (finding all updates for a job)
-- Only index non-null values since most jobs won't have this
CREATE INDEX idx_playlist_jobs_original_job_id 
ON public.playlist_jobs(original_job_id) 
WHERE original_job_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.playlist_jobs.original_job_id IS 
'For update jobs: references the original job that created this playlist. NULL for original jobs.';
