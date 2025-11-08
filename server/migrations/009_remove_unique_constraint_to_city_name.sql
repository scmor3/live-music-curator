-- Up
    -- This migration UNDOES the '008' migration, which was based on a
    -- faulty diagnosis of the seed script bug.
    -- We are removing the UNIQUE constraint on 'name' to allow for
    -- potential duplicates in the seed data (e.g., two "Springfield, England" entries).
    ALTER TABLE cities
    DROP CONSTRAINT IF EXISTS cities_name_unique;