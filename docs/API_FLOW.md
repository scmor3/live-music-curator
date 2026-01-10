# API Flow Notes

#### Section 1: User Authentication Flow (Supabase Auth):
story:
1. User visits the app. The frontend automatically signs them in anonymously via Supabase (`signInAnonymously()`).
2. If the user wants to save playlists to their library, they can open the auth modal to create an account.
3. User enters email and password to sign up. The frontend calls Supabase `signUp()` method.
    * If an anonymous session exists, Supabase attempts to upgrade it to a full account.
    * If the anonymous user was deleted from the database (stale session), the frontend clears the session and creates a fresh account.
4. For login, the frontend calls Supabase `signInWithPassword()` with email and password.
5. Supabase returns a JWT access token which is stored in the browser session.
6. For authenticated requests, the frontend includes the token in the `Authorization: Bearer <token>` header.
7. The backend verifies the token using Supabase Admin client (`supabaseAdmin.auth.getUser(token)`) and extracts the user ID from the JWT payload.
8. Anonymous users can create playlists but cannot save them to their library. They must create an account first.

#### Section 2: Playlist Curation Flow (Asynchronous Job Queue):
story:
1. **Data submission**: User submits `city` (name), `date` (YYYY-MM-DD), `lat`/`lon` (coordinates), optional `genres` (comma-separated excluded genres), optional `minStartTime`/`maxStartTime` (0-24 hour range).
2. **Client request**: Frontend sends GET request to `/api/playlists` with query parameters. Includes `Authorization: Bearer <token>` header if user is authenticated (optional for anonymous users).
3. **Job creation**: Backend checks for existing jobs with same city, date, and filters. If found, returns existing job ID (prevents duplicates). Otherwise, creates new row in `playlist_jobs` table with status `'pending'`.
4. **Immediate response**: Server returns HTTP 202 (Accepted) with `{ jobId: <id> }` immediately. The frontend does not wait for playlist creation to complete.
5. **Background processing**: Worker threads (4 concurrent workers) poll the database every 10 seconds for `'pending'` jobs. When found:
    * Worker updates job status to `'building'` (locks the job using `FOR UPDATE SKIP LOCKED`)
    * Worker checks for zombie jobs (stuck in `'building'` status >30 minutes) and marks them `'failed'`
6. **Curation iteration** (inside `runCurationLogic`):
    * Scrapes Bandsintown for all events on the given date and location (uses got-scraping, falls back to Playwright if blocked)
    * Filters events by time range if specified (parses event start time from ISO date string)
    * Deduplicates events by artist name (case-insensitive)
    * Saves event list to `playlist_jobs.events_data` JSONB column for frontend display
    * Creates empty playlist on master Spotify account (`/v1/users/{master_id}/playlists`)
    * For each unique artist:
        * Searches Spotify API (`/v1/search?q={artist}&type=artist`)
        * Finds best match: exact match first (case-insensitive), then Levenshtein distance with threshold of 1
        * Applies genre filtering with synonym expansion (excludes artist if any genre matches excluded list)
        * Skips duplicate Spotify artist IDs (already processed)
        * Fetches top tracks (`/v1/artists/{id}/top-tracks`) and takes first 1 song (hardcoded)
        * Adds tracks to playlist (`/v1/playlists/{id}/tracks`)
        * Updates job log with progress (`updateJobLog` appends to `log_history` array)
        * Handles retries for rate limits (429) and server errors (5xx) with exponential backoff (max 3 retries)
7. **Job completion**: After all artists processed:
    * If no tracks were added, deletes empty playlist from Spotify and marks job as `'failed'`
    * Otherwise, updates job status to `'complete'` with `playlist_id` and `events_data` saved
8. **Status polling**: Frontend polls `/api/playlists/status?jobId={id}` every 5 seconds. Response includes:
    * `status`: 'pending', 'building', 'complete', or 'failed'
    * `playlistId`: Spotify playlist ID (if complete)
    * `error`: Error message (if failed)
    * `logs`: Array of log messages showing progress
    * `progress`: Object with `total` and `current` artist counts
    * `events`: Array of event objects with artist info
9. **Frontend display**: Live activity feed displays logs in real-time, showing artist matches, skips, and completion status. When status is `'complete'`, frontend displays playlist link and save button.

#### Section 3: Saving Playlists to User Library:
story:
1. User clicks "Save to Library" button after playlist is complete. If anonymous, auth modal opens.
2. Frontend sends POST request to `/api/save-playlist` with `{ jobId: <id> }` and Authorization header.
3. Backend verifies authentication (401 if no token). Fetches job details from `playlist_jobs` table.
4. Backend checks for existing saved playlist with same `user_id`, `city_name`, and `playlist_date` in `saved_playlists` table.
5. If exists: Updates existing row with new `playlist_id`, `events_snapshot`, and filters. Returns `{ success: true, action: 'updated' }`.
6. If new: Inserts new row into `saved_playlists` table with all job metadata. Returns `{ success: true, action: 'created' }`.
7. Frontend displays success message and updates UI.

#### Section 4: Managing Saved Playlists:
story:
1. **Fetch library**: Frontend calls `GET /api/my-playlists` with Authorization header. Backend returns all playlists for authenticated user, ordered by `created_at DESC`.
2. **Refresh playlist**: Frontend calls `POST /api/my-playlists/:id/refresh` with Authorization header. Backend:
    * Fetches saved playlist details
    * Creates new job in `playlist_jobs` with same parameters
    * Immediately runs curation logic (synchronously, status 'building')
    * Updates saved playlist with new `playlist_id` and `events_snapshot`
    * Returns new playlist ID and events array
3. **Delete playlist**: Frontend calls `DELETE /api/my-playlists/:id` with Authorization header. Backend deletes row from `saved_playlists` table (only if owned by user). Returns `{ success: true }`.

#### Section 5: City Search Endpoints:
story:
1. **Autocomplete**: Frontend calls `GET /api/search-cities?q={query}` as user types. Backend:
    * Uses PostgreSQL trigram similarity (`pg_trgm` extension) for fuzzy search
    * Orders by prefix match, then similarity score, then population
    * Returns array of city objects with `name`, `latitude`, `longitude`, `population`
2. **Geographic lookup**: Frontend calls `GET /api/city-from-coords?lat={lat}&lon={lon}` when user allows location access. Backend:
    * Uses PostGIS `geography` column with GIST index for fast spatial queries
    * Finds nearest city using `ORDER BY geography <-> ST_MakePoint(...)`
    * Returns closest city object

#### Section 6: Health & Maintenance Endpoints:
story:
1. **Health check**: `GET /` - Pings database with retry logic (4 attempts, 15s delay). Returns `{ message: 'Server and Database are up and running!' }` or 503 if DB is down.
2. **Keep-alive**: `GET /api/keep-alive` - Fire-and-forget endpoint for cron jobs. Responds immediately with 200, then pings DB in background to prevent Supabase from sleeping.
