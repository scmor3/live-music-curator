CREATE TABLE curation_requests (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  search_city VARCHAR(255) NOT NULL,
  search_date DATE NOT NULL,
  number_of_songs INT NOT NULL,
  playlist_id TEXT UNIQUE
);

CREATE TABLE curated_artists (
  id SERIAL PRIMARY KEY,
  curation_request_id INT REFERENCES curation_requests(id),
  artist_name_raw VARCHAR(255) NOT NULL,
  spotify_artist_id TEXT,
  confidence_score DECIMAL(5, 2)
);