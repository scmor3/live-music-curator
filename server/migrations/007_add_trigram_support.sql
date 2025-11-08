-- Up

-- 1. "Install" the trigram extension in our database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Abandon our "dumb" normalized column.
DROP INDEX IF EXISTS idx_cities_name_normalized;
ALTER TABLE cities DROP COLUMN IF EXISTS city_normalized;

-- 3. Drop the UNIQUE constraint on 'name'
ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_name_key;

-- 4. Create a new, *fuzzy-search* index on the *full name* column (e.g., "Austin, Texas").
CREATE INDEX idx_cities_name_trgm ON cities USING gin (name gin_trgm_ops);