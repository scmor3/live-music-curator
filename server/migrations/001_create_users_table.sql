CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  spotify_id VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  profile_picture TEXT,
  refresh_token TEXT NOT NULL
);