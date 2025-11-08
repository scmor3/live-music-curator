-- Up
-- This migration upgrades the 'cities' table for fast, case-insensitive searching.

-- 1. Add the new 'city_normalized' column
ALTER TABLE cities
ADD COLUMN city_normalized VARCHAR(255);

-- 2. Add the 'city', 'admin_name', and 'country' columns
--    that our seed script will populate.
ALTER TABLE cities
ADD COLUMN city VARCHAR(255),
ADD COLUMN admin_name VARCHAR(255),
ADD COLUMN country VARCHAR(255);

-- 3. let's make sure the column is required.
ALTER TABLE cities
ALTER COLUMN city_normalized SET NOT NULL;

-- 4. Drop the old 'UNIQUE' constraint on 'name'
ALTER TABLE cities
DROP CONSTRAINT cities_name_key;

-- 5. Create the new, fast index on our normalized column
CREATE INDEX idx_cities_name_normalized ON cities (city_normalized);