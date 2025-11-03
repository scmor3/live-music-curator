-- This migration refactors the schema for the "public curator" model.

-- 1. Drop the `users` table.
-- We use CASCADE, which is a "sledgehammer" that automatically
-- finds and drops any Foreign Key constraints that reference
-- this table (like the one on curation_requests.user_id).
DROP TABLE users CASCADE;

-- 2. Drop the `user_id` column from curation_requests.
-- The CASCADE above only dropped the *constraint*, not the
-- column itself. We drop it now as it's no longer needed.
ALTER TABLE curation_requests DROP COLUMN user_id;