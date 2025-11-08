-- Up

-- We are re-adding the UNIQUE constraint to the 'name' column.
-- This is necessary for our seed script's "ON CONFLICT DO NOTHING"
-- to work correctly, preventing duplicate city entries.
ALTER TABLE cities
ADD CONSTRAINT cities_name_unique UNIQUE (name);