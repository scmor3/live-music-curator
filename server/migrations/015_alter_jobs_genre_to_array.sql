-- 1. Drop the single-string column we just added
ALTER TABLE public.playlist_jobs
DROP COLUMN genre;

-- 2. Add a new column that can hold an ARRAY of strings
ALTER TABLE public.playlist_jobs
ADD COLUMN excluded_genres TEXT[] NULL;