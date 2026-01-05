ALTER TABLE saved_playlists
ADD COLUMN min_start_time INTEGER DEFAULT 0,
ADD COLUMN max_start_time INTEGER DEFAULT 24,
ADD COLUMN excluded_genres TEXT[] DEFAULT NULL;