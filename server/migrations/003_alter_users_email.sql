-- Up
-- Allow the email column to be empty (null)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Remove the unique constraint (a null value can't be unique)
-- The name 'users_email_key' is the default one PostgreSQL creates.
ALTER TABLE users DROP CONSTRAINT users_email_key;