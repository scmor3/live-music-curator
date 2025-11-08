-- Up
CREATE TABLE cities (
  id SERIAL PRIMARY KEY,

  -- This will be the search query, e.g., "Austin, TX"
  -- We add UNIQUE to ensure we only cache each city once.
  name VARCHAR(255) NOT NULL UNIQUE,

  -- We use DECIMAL for high-precision coordinates.
  latitude DECIMAL(9, 6) NOT NULL,
  longitude DECIMAL(9, 6) NOT NULL,

  -- This is just good practice to see when a city was added.
  created_at TIMESTAMPTZ DEFAULT NOW()
);