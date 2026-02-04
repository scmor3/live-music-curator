-- Purpose: Create table to track email requests for playlist links
-- This allows us to:
-- 1. Track all email requests for analytics
-- 2. Store email addresses for future marketing (with user consent)
-- 3. Handle deferred email sending when playlists are still building
-- 4. Track success/failure rates

CREATE TABLE email_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User who requested the email (nullable for anonymous users)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- The email address the playlist was sent to
  email VARCHAR(255) NOT NULL,
  
  -- Spotify playlist ID
  playlist_id VARCHAR(255) NOT NULL,
  
  -- Link to the job (for context and deferred sending)
  job_id BIGINT REFERENCES playlist_jobs(id) ON DELETE SET NULL,
  
  -- Context information for email template
  city_name VARCHAR(255),
  playlist_date DATE,
  
  -- Status tracking
  status VARCHAR(50) DEFAULT 'pending' NOT NULL, -- 'pending', 'sent', 'failed'
  
  -- Timestamps
  sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for querying by user
CREATE INDEX idx_email_requests_user_id ON email_requests(user_id);

-- Index for querying by email (for marketing)
CREATE INDEX idx_email_requests_email ON email_requests(email);

-- Index for querying by status (for finding pending emails to send)
CREATE INDEX idx_email_requests_status ON email_requests(status);

-- Index for querying by job_id (for finding pending emails when job completes)
CREATE INDEX idx_email_requests_job_id ON email_requests(job_id) WHERE status = 'pending';
