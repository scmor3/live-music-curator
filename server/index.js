// --- Imports ---
const express = require('express');
const axios = require('axios');
const postgres = require('postgres');
const levenshtein = require('fast-levenshtein');
const cors = require('cors');
const path = require('path'); 
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const { scrapeBandsintown } = require('./utils/bandsintownScraper');
const { sendPlaylistEmail } = require('./utils/emailService');
// --- Logger Configuration ---
// Get the log level from environment variables. Default to 'info' for production.
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const logger = {
  // Use for SUPER spammy, repetitive logs (like "checking for jobs")
  superDebug: (message, ...args) => {
    if (LOG_LEVEL === 'superDebug') {
      console.log(`[SUPER DEBUG] ${message}`, ...args);
    }
  },
  // Use for spammy, repetitive logs
  debug: (message, ...args) => {
    if (LOG_LEVEL === 'debug') {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  },
  // Use for important, high-level events (like a job starting)
  info: (message, ...args) => {
    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'info') {
      console.log(`[INFO] ${message}`, ...args);
    }
  },
  // Use for non-critical warnings
  warn: (message, ...args) => {
    console.warn(`[WARN] ${message}`, ...args);
  },
  // Use for app-breaking errors
  error: (message, ...args) => {
    console.error(`[ERROR] ${message}`, ...args);
  }
};
// --- End Logger Configuration ---

logger.info("--- RUNNING LATEST INDEX.JS (DATABASE_URL version) ---");

// --- GLOBAL RATE LIMIT COORDINATION ---
// Shared state across all workers to coordinate rate limiting
// When any worker gets a 429, all workers pause until rate limit resets
// State is persisted to database to survive server restarts
const globalRateLimit = {
  isLimited: false,
  expiresAt: null, // Timestamp when rate limit expires
  retryAfter: null // Seconds to wait (from Retry-After header)
};

/**
 * Load rate limit state from database on server startup
 * This prevents making requests immediately after restart if we were rate limited
 * Loads the rate limit state for the currently selected account
 */
async function loadRateLimitFromDatabase() {
  try {
    const result = await sql`
      SELECT rate_limit_expires_at 
      FROM rate_limit_state 
      WHERE account_type = ${CURRENT_ACCOUNT_TYPE}
    `;
    
    if (result.length > 0 && result[0].rate_limit_expires_at) {
      const expiresAt = new Date(result[0].rate_limit_expires_at).getTime();
      const now = Date.now();
      
      if (expiresAt > now) {
        // Rate limit is still active
        globalRateLimit.isLimited = true;
        globalRateLimit.expiresAt = expiresAt;
        const remainingSeconds = Math.ceil((expiresAt - now) / 1000);
        globalRateLimit.retryAfter = remainingSeconds;
        logger.warn(`[RATE-LIMIT] [${CURRENT_ACCOUNT_NAME}] Loaded active rate limit from database. Expires in ${remainingSeconds}s (at ${new Date(expiresAt).toISOString()})`);
      } else {
        // Rate limit expired, clear it
        await sql`DELETE FROM rate_limit_state WHERE account_type = ${CURRENT_ACCOUNT_TYPE}`;
        logger.info(`[RATE-LIMIT] [${CURRENT_ACCOUNT_NAME}] Found expired rate limit in database. Cleared.`);
      }
    }
  } catch (error) {
    // Table might not exist yet, that's okay
    logger.debug(`[RATE-LIMIT] Could not load rate limit from database: ${error.message}`);
  }
}

/**
 * Save rate limit state to database so it persists across restarts
 * Saves the rate limit state for the currently selected account
 */
async function saveRateLimitToDatabase(expiresAt) {
  try {
    await sql`
      INSERT INTO rate_limit_state (account_type, rate_limit_expires_at, updated_at)
      VALUES (${CURRENT_ACCOUNT_TYPE}, ${new Date(expiresAt).toISOString()}, NOW())
      ON CONFLICT (account_type) 
      DO UPDATE SET 
        rate_limit_expires_at = ${new Date(expiresAt).toISOString()},
        updated_at = NOW()
    `;
  } catch (error) {
    // Table might not exist, log but don't fail
    logger.warn(`[RATE-LIMIT] [${CURRENT_ACCOUNT_NAME}] Could not save rate limit to database: ${error.message}`);
  }
}

/**
 * Clear rate limit state from database
 * Clears the rate limit state for the currently selected account
 */
async function clearRateLimitFromDatabase() {
  try {
    await sql`DELETE FROM rate_limit_state WHERE account_type = ${CURRENT_ACCOUNT_TYPE}`;
  } catch (error) {
    // Ignore errors
  }
}

/**
 * Check if we're currently rate limited and wait if necessary
 * All workers call this before making Spotify API requests
 */
async function waitForRateLimit(logPrefix = '') {
  if (!globalRateLimit.isLimited) {
    return; // Not rate limited, proceed
  }

  // Check if rate limit has expired
  if (globalRateLimit.expiresAt && Date.now() >= globalRateLimit.expiresAt) {
    // Rate limit expired, clear it
    globalRateLimit.isLimited = false;
    globalRateLimit.expiresAt = null;
    globalRateLimit.retryAfter = null;
    clearRateLimitFromDatabase(); // Remove from database
    logger.info(`${logPrefix} [RATE-LIMIT] [${CURRENT_ACCOUNT_NAME}] Rate limit expired. Resuming requests.`);
    return;
  }

  // Calculate how long to wait
  const waitMs = globalRateLimit.expiresAt 
    ? Math.max(globalRateLimit.expiresAt - Date.now(), 0)
    : (globalRateLimit.retryAfter || 5) * 1000;

  if (waitMs > 0) {
    logger.warn(`${logPrefix} [RATE-LIMIT] [${CURRENT_ACCOUNT_NAME}] Global rate limit active. Waiting ${Math.ceil(waitMs/1000)}s before proceeding...`);
    await sleep(waitMs);
    
    // Clear rate limit after waiting
    globalRateLimit.isLimited = false;
    globalRateLimit.expiresAt = null;
    globalRateLimit.retryAfter = null;
    clearRateLimitFromDatabase(); // Remove from database
    logger.info(`${logPrefix} [RATE-LIMIT] [${CURRENT_ACCOUNT_NAME}] Rate limit cleared. Resuming requests.`);
  }
}

/**
 * Set global rate limit when a 429 error is received
 * All workers will respect this and pause their requests
 */
function setGlobalRateLimit(retryAfterSeconds, logPrefix = '') {
  const retryAfter = Number(retryAfterSeconds) || 5;
  const waitMs = retryAfter * 1000;
  const expiresAt = Date.now() + waitMs;

  // Log what Spotify told us
    logger.warn(`${logPrefix} [RATE-LIMIT] [${CURRENT_ACCOUNT_NAME}] Received Retry-After header: ${retryAfterSeconds} seconds (parsed as: ${retryAfter}s)`);

  // Only update if not already limited, or if new expiration is LATER than current
  // This prevents race conditions where multiple workers set rate limits simultaneously
  if (!globalRateLimit.isLimited || !globalRateLimit.expiresAt || expiresAt > globalRateLimit.expiresAt) {
    globalRateLimit.isLimited = true;
    globalRateLimit.expiresAt = expiresAt;
    globalRateLimit.retryAfter = retryAfter;

    // Persist to database so it survives server restarts
    saveRateLimitToDatabase(expiresAt);

    logger.warn(`${logPrefix} [RATE-LIMIT] [${CURRENT_ACCOUNT_NAME}] Global rate limit set. All workers will pause for ${retryAfter}s (until ${new Date(expiresAt).toISOString()})`);
  } else {
    // Rate limit already set with later expiration, don't overwrite
    logger.debug(`${logPrefix} [RATE-LIMIT] [${CURRENT_ACCOUNT_NAME}] Rate limit already active until ${new Date(globalRateLimit.expiresAt).toISOString()}. Not updating.`);
  }
}
// --- END GLOBAL RATE LIMIT COORDINATION ---

// Initialize Supabase Admin Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  logger.warn('⚠️ Missing SUPABASE_SERVICE_KEY. Auth verification will fail.');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// --- App & Middleware Configuration ---
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
// Whitelist of all allowed frontend URLs
const allowedOrigins = [
  // --- Production URLs ---
  'https://livemusiccurator.com',
  'https://www.livemusiccurator.com',
  // --- Legacy URLs (keep for backwards compatibility during transition) ---
  'https://live-music-curator.vercel.app',
  'https://live-music-curator-git-deployment-prep-scmor3s-projects.vercel.app',
  // --- Local Development ---
  'http://172.17.236.175:3001', // Your specific WSL frontend
  'http://localhost:3001'      // Standard localhost frontend
];

const corsOptions = {
  origin: function (origin, callback) {
    
    // Show us the exact origin Vercel is sending.
    logger.debug('CORS CHECK: Received origin:', origin);

    // Check if the incoming request's 'origin' is in our whitelist
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      // If it is (or a server-to-server request), allow it.
      callback(null, true);
    } else {
      // If it's not in the whitelist, block it.
      logger.warn('CORS BLOCKED:', origin); // Log the blocked origin
      
      // Send 'false' to block the request, instead of an Error to avoid crashing the server.
      callback(null, false); 
    }
  }
};
app.use(cors(corsOptions));

let sql;

// This object tells the 'postgres' library how to handle specific data types.
// We are telling it to treat 'date' (type 1082) as plain text, not a JS Date.
const typeOptions = {
  date: 1082,
  types: {
    date: {
      to: 1082,
      from: [1082],
      serialize: (val) => val,
      parse: (val) => val, // Return the raw string 'YYYY-MM-DD'
    },
  },
};
// Check which environment variables are available
if (process.env.DATABASE_URL) {
  // --- PRODUCTION ---
  // Render provides the DATABASE_URL. Use it.
  logger.info('Connecting to database using DATABASE_URL...');
  // We use postgres.options to merge our connection string with our new type option
  sql = postgres(process.env.DATABASE_URL, {
    ...typeOptions,
    onnotice: () => {},
  });
} else {
  // --- LOCAL ---
  // We're local. Use the .env file's separate variables.
  logger.info('Connecting to database using local .env variables...');
  sql = postgres({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    onnotice: () => {},
    ...typeOptions, // <-- Add the new options here
  });
}


// --- Constants ---
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const MASTER_REFRESH_TOKEN = process.env.MASTER_REFRESH_TOKEN;
const MASTER_SPOTIFY_ID = process.env.MASTER_SPOTIFY_ID;
const MASTER_REFRESH_TOKEN_BACKUP = process.env.MASTER_REFRESH_TOKEN_BACKUP;
const MASTER_SPOTIFY_ID_BACKUP = process.env.MASTER_SPOTIFY_ID_BACKUP;

// --- Account Selection ---
// Set USE_BACKUP_ACCOUNT=true or 1 to use backup account, otherwise uses primary
const USE_BACKUP_ACCOUNT = process.env.USE_BACKUP_ACCOUNT === 'true';
const CURRENT_ACCOUNT_TYPE = USE_BACKUP_ACCOUNT ? 2 : 1; // 1 = primary, 2 = backup
const CURRENT_REFRESH_TOKEN = USE_BACKUP_ACCOUNT ? MASTER_REFRESH_TOKEN_BACKUP : MASTER_REFRESH_TOKEN;
const CURRENT_SPOTIFY_ID = USE_BACKUP_ACCOUNT ? MASTER_SPOTIFY_ID_BACKUP : MASTER_SPOTIFY_ID;
const CURRENT_ACCOUNT_NAME = USE_BACKUP_ACCOUNT ? 'BACKUP' : 'PRIMARY';

if (USE_BACKUP_ACCOUNT) {
  logger.info(`[ACCOUNT] Using BACKUP Spotify account (ID: ${CURRENT_SPOTIFY_ID})`);
  if (!MASTER_REFRESH_TOKEN_BACKUP || !MASTER_SPOTIFY_ID_BACKUP) {
    logger.warn('⚠️  USE_BACKUP_ACCOUNT is enabled but backup credentials are missing!');
  }
} else {
  logger.info(`[ACCOUNT] Using PRIMARY Spotify account (ID: ${CURRENT_SPOTIFY_ID})`);
}

// --- Master Access Token Caching ---
// Cache the master access token to avoid refreshing it for every job
// Spotify access tokens typically expire after 1 hour
// Separate cache for each account type
let masterAccessTokenCache = {
  token: null,
  expiresAt: null,
  accountType: null // Track which account this cache is for
};
let tokenRefreshInProgress = false; // Mutex to prevent concurrent refreshes
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiration

// --- Helper Functions ---

/**
 * A simple helper function to pause execution.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Verifies the JWT token and syncs the user to the local DB if needed.
 */
async function getUserIdFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const token = authHeader.split(' ')[1]; // Remove "Bearer "
  if (!token) return null;

  try {
    // 1. Verify token with Supabase Cloud
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      logger.debug(`Auth verification failed: ${error?.message}`);
      return null;
    }

    // 2. Just-in-Time Sync (Local Dev Only)
    // If we are running locally, the user ID might not exist in our local 'auth.users' table.
    // We insert it now to prevent Foreign Key errors.
    if (!process.env.DATABASE_URL) { // !DATABASE_URL usually implies local .env usage
      try {
        await sql`
          INSERT INTO auth.users (id, email)
          VALUES (${user.id}, ${user.email})
          ON CONFLICT (id) DO UPDATE 
          SET email = EXCLUDED.email
        `;
        // logger.debug(`[Local Sync] Synced user ${user.id} to local DB.`);
      } catch (syncErr) {
        logger.warn(`[Local Sync] Failed to sync user: ${syncErr.message}`);
      }
    }

    return user.id;
  } catch (err) {
    logger.error(`Unexpected auth error: ${err.message}`);
    return null;
  }
}

/**
 * Uses the master refresh token to get a new, valid master access token.
 * Implements caching and mutex to prevent concurrent refresh requests.
 * Uses the currently selected account (primary or backup).
 */
async function getMasterAccessToken() {
  const now = Date.now();
  
  // Check if we have a valid cached token for the current account
  if (masterAccessTokenCache.token && 
      masterAccessTokenCache.expiresAt && 
      masterAccessTokenCache.expiresAt > now &&
      masterAccessTokenCache.accountType === CURRENT_ACCOUNT_TYPE) {
    return masterAccessTokenCache.token;
  }
  
  // If cache is for a different account, clear it
  if (masterAccessTokenCache.accountType !== null && masterAccessTokenCache.accountType !== CURRENT_ACCOUNT_TYPE) {
    masterAccessTokenCache = { token: null, expiresAt: null, accountType: null };
  }
  
  // If a refresh is already in progress, wait for it
  while (tokenRefreshInProgress) {
    await sleep(100); // Wait 100ms and check again
  }
  
  // Double-check cache after waiting (another worker might have refreshed it)
  if (masterAccessTokenCache.token && 
      masterAccessTokenCache.expiresAt && 
      masterAccessTokenCache.expiresAt > now &&
      masterAccessTokenCache.accountType === CURRENT_ACCOUNT_TYPE) {
    return masterAccessTokenCache.token;
  }
  
  // Acquire mutex
  tokenRefreshInProgress = true;
  
  try {
    const authHeader = 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'));
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', CURRENT_REFRESH_TOKEN);

    // Retry logic for token refresh (3 retries with exponential backoff)
    const MAX_TOKEN_REFRESH_RETRIES = 3;
    let lastError;
    
    for (let retryCount = 0; retryCount <= MAX_TOKEN_REFRESH_RETRIES; retryCount++) {
      try {
        if (retryCount > 0) {
          const backoffMs = Math.min(1000 * Math.pow(2, retryCount - 1), 10000); // 1s, 2s, 4s, max 10s
          logger.warn(`[TOKEN-REFRESH] Retry ${retryCount}/${MAX_TOKEN_REFRESH_RETRIES} after ${backoffMs}ms...`);
          await sleep(backoffMs);
        }
        
        const response = await axios.post('https://accounts.spotify.com/api/token', params, {
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'Authorization': authHeader
          }
        });

        const accessToken = response.data.access_token;
        const expiresIn = response.data.expires_in || 3600; // Default to 1 hour if not provided
        
        // Cache the token with expiration time (subtract buffer to refresh early)
        masterAccessTokenCache = {
          token: accessToken,
          expiresAt: now + (expiresIn * 1000) - TOKEN_REFRESH_BUFFER_MS,
          accountType: CURRENT_ACCOUNT_TYPE
        };
        
        logger.info(`[TOKEN-REFRESH] [${CURRENT_ACCOUNT_NAME}] Successfully refreshed master access token. Expires in ${expiresIn}s (cached until ${new Date(masterAccessTokenCache.expiresAt).toISOString()})`);
        
        // We don't need to handle new refresh tokens for the master account,
        // as we can just re-authenticate manually if it ever expires.
        return accessToken;
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const errorData = error.response?.data;
        const retryAfter = error.response?.headers?.['retry-after'];
        
        if (status === 429 && retryAfter) {
          // Rate limited - wait for the specified time
          const waitSeconds = parseInt(retryAfter, 10);
          logger.warn(`[TOKEN-REFRESH] Rate limited. Waiting ${waitSeconds}s before retry...`);
          await sleep(waitSeconds * 1000);
          continue; // Retry after waiting
        }
        
        // Log detailed error for debugging
        logger.error(`[TOKEN-REFRESH] Attempt ${retryCount + 1}/${MAX_TOKEN_REFRESH_RETRIES + 1} failed:`, {
          status,
          statusText,
          errorData,
          retryAfter,
          message: error.message
        });
        
        // If this is the last retry, break and throw
        if (retryCount === MAX_TOKEN_REFRESH_RETRIES) {
          break;
        }
      }
    }
    
    // All retries failed
    logger.error('CRITICAL: Could not refresh master access token after all retries!', {
      status: lastError?.response?.status,
      statusText: lastError?.response?.statusText,
      errorData: lastError?.response?.data,
      message: lastError?.message
    });
    throw new Error(`Failed to get master access token after ${MAX_TOKEN_REFRESH_RETRIES + 1} attempts: ${lastError?.response?.status || lastError?.message}`);
  } finally {
    // Release mutex
    tokenRefreshInProgress = false;
  }
}

/**
 * Helper to push a log message to the database and update progress counts.
 */
async function updateJobLog(jobId, message, processedCount = null, totalCount = null) {
  try {
    // Construct the dynamic update object
    // We utilize the '||' operator for array concatenation in Postgres
    await sql`
      UPDATE playlist_jobs
      SET 
        log_history = array_append(log_history, ${message}),
        processed_artists = COALESCE(${processedCount}, processed_artists),
        total_artists = COALESCE(${totalCount}, total_artists),
        updated_at = NOW()
      WHERE id = ${jobId};
    `;
  } catch (err) {
    // Fail silently so we don't crash the main worker if a log fails
    logger.warn(`Failed to update log for job ${jobId}: ${err.message}`);
  }
}

function formatDatePretty(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${month}-${day}-${year}`;
}

function formatHourShort(hour) {
  if (hour === 0 || hour === 24) return '12am';
  if (hour === 12) return '12pm';
  return hour > 12 ? `${hour - 12}pm` : `${hour}am`;
}

/**
 * Creates a new playlist, finds/adds tracks, and saves all results to the DB.
 */
async function runCurationLogic(jobId, city, date, number_of_songs, accessToken, latitude, longitude, excludedGenres, minStartTime, maxStartTime, workerId) {
  // Add log prefix for easier tracing
  const logPrefix = `[Worker ${workerId}]`;
  
  // Rate limiting: Delay between Spotify API calls to prevent 429 errors
  // With 16 concurrent workers, we need aggressive throttling
  // Spotify allows ~30 req/sec total, so with 16 workers: 30/16 = ~1.9 req/sec per worker
  // Increasing to 1000ms delay = 1 req/sec per worker = 16 req/sec total (safer buffer)
  // Can be overridden with SPOTIFY_API_DELAY_MS env var (in milliseconds)
  const SPOTIFY_API_DELAY_MS = parseInt(process.env.SPOTIFY_API_DELAY_MS || '1000', 10);
  
  // await updateJobLog(jobId, `Scouting venues in ${city} for ${date}...`);
  // Get the raw artist list by calling our scraper
  const rawEventsList = await scrapeBandsintown(date, latitude, longitude, workerId);

  // --- Time Filter Logic ---
  let timeFilteredEvents = rawEventsList;

  // Parse inputs (default to 0 and 24 if undefined)
  const minHour = minStartTime ? parseInt(minStartTime) : 0;
  const maxHour = maxStartTime ? parseInt(maxStartTime) : 24;

  // Only filter if we have a restriction (Min > 0 OR Max < 24)
  if (minHour > 0 || maxHour < 24) {

    // We filter rawEventsList BEFORE the loop
    timeFilteredEvents = rawEventsList.filter(event => {
      // event.date is "2025-12-23T19:00:00". 
      // We rely on string parsing to ensure we respect Venue Local Time.
      if (!event.date || !event.date.includes('T')) return true; // Keep events with missing time

      try {
        const timePart = event.date.split('T')[1]; // "19:00:00"
        const hourStr = timePart.split(':')[0];    // "19"
        const hour = parseInt(hourStr, 10);
        return hour >= minHour && hour < maxHour;
      } catch (e) {
        return true; // If parsing fails, be safe and keep it
      }
    });

    logger.info(`${logPrefix} Time Filter (${minHour}:00 - ${maxHour}:00): Reduced ${rawEventsList.length} events to ${timeFilteredEvents.length}.`);
  }

  // --- Construct Naming & Logging Strings ---
  const prettyDate = formatDatePretty(date);
  
  let timeContext = '';
  if (minHour > 0) timeContext += `After ${formatHourShort(minHour)}`;
  if (maxHour < 24) {
    if (timeContext) timeContext += ', ';
    timeContext += `Before ${formatHourShort(maxHour)}`;
  }

  // Create suffixes for the playlist name
  let nameContext = '';
  if (timeContext) nameContext += ` (${timeContext})`;

  // Genres suffix
  if (excludedGenres && excludedGenres.length > 0) {
    const prettyGenres = excludedGenres.map(g => g.charAt(0).toUpperCase() + g.slice(1)).join(', ');
    // If we already have time context, append with comma
    if (nameContext) {
      nameContext = nameContext.slice(0, -1) + `, Excl: ${prettyGenres})`;
    } else {
      nameContext = ` (Excl: ${prettyGenres})`;
    }
  }

  // Check if we found any artists (using the FILTERED list).
  if (!timeFilteredEvents || timeFilteredEvents.length === 0) {
    logger.info(`${logPrefix} No artists found for "${city}" on ${prettyDate}${nameContext} (after time filtering).`);
    return { playlistId: null, events: [] };
  }

  // --- DEBUG LOG START ---
  if (rawEventsList && rawEventsList.length > 0) {
    const sample = rawEventsList[0];
    logger.warn(`${logPrefix} [DEBUG] Scraper returned ${rawEventsList.length} items.`);
    logger.warn(`${logPrefix} [DEBUG] Sample Item 0: ${JSON.stringify(sample)}`);
    // Check if image exists
    if (!sample.image) logger.error(`${logPrefix} [CRITICAL] Scraper returned object WITHOUT image property!`);
  } else {
    logger.error(`${logPrefix} [CRITICAL] Scraper returned EMPTY list.`);
  }
  // --- DEBUG LOG END ---

  // Check if we found any artists.
  if (!rawEventsList || rawEventsList.length === 0) {
    logger.info(`${logPrefix} No artists found for "${city}" on ${date}.`);
    return { playlistId: null, events: [] };
  }

  // await updateJobLog(jobId, `Scout returned! Found ${rawArtistList.length} artists.`, 0, rawArtistList.length);

  // Create the new empty playlist on Spotify
  const playlistData = {
    // UPDATED: Use new naming variables
    name: `${city} ${prettyDate} live music${nameContext}`,
    description: `Artists performing in ${city} on ${prettyDate}${timeContext ? ` ${timeContext}` : ''}, curated by Live Music Curator.`,
    public: true
  };
  const axiosConfig = {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  };

  // await updateJobLog(jobId, "Creating empty playlist on Spotify...");

  // Rate limiting: Check global rate limit BEFORE creating playlist
  await waitForRateLimit(logPrefix);
  
  // Additional pre-emptive delay to prevent hitting rate limits
  await sleep(SPOTIFY_API_DELAY_MS);

  // Create playlist with retry logic for rate limits
  let playlistId = null;
  const MAX_PLAYLIST_CREATE_RETRIES = 3;
  let playlistRetryCount = 0;
  
  while (playlistRetryCount < MAX_PLAYLIST_CREATE_RETRIES && !playlistId) {
    try {
      // Check rate limit before each retry attempt
      await waitForRateLimit(logPrefix);
      await sleep(SPOTIFY_API_DELAY_MS);
      
      const createPlaylistResponse = await axios.post(
        `https://api.spotify.com/v1/users/${CURRENT_SPOTIFY_ID}/playlists`,
        playlistData,
        axiosConfig
      );
      playlistId = createPlaylistResponse.data.id;
      logger.info(`${logPrefix} Successfully created new playlist with ID: ${playlistId}`);
    } catch (playlistError) {
      const playlistStatus = playlistError.response ? playlistError.response.status : null;
      playlistRetryCount++;
      
      if (playlistStatus === 429 && playlistRetryCount < MAX_PLAYLIST_CREATE_RETRIES) {
        // Set global rate limit and wait
        const retryAfterSeconds = playlistError.response?.headers?.['retry-after'] || 
                                 playlistError.response?.headers?.['Retry-After'] || 5;
        logger.warn(`${logPrefix} [RATE-LIMIT] Playlist creation 429 - Headers: ${JSON.stringify(playlistError.response?.headers)}`);
        setGlobalRateLimit(retryAfterSeconds, logPrefix);
        await waitForRateLimit(logPrefix);
        logger.warn(`${logPrefix} Playlist creation failed with 429. Retry ${playlistRetryCount}/${MAX_PLAYLIST_CREATE_RETRIES}...`);
      } else {
        // Not retryable or out of retries
        logger.error(`${logPrefix} Failed to create playlist. Status: ${playlistStatus}. Giving up after ${playlistRetryCount} attempts.`);
        throw playlistError; // Re-throw to be caught by outer try-catch
      }
    }
  }
  
  if (!playlistId) {
    throw new Error('Failed to create playlist after all retries');
  }

  // --- Deduplication Logic for Objects ---
  // We need to deduplicate by Artist Name, but keep the event object.
  const uniqueEventsMap = new Map();

  timeFilteredEvents.forEach(event => { 
    // Normalize name for key (lowercase, trimmed)
    const key = event.name.toLowerCase().trim();
    if (!uniqueEventsMap.has(key)) {
      uniqueEventsMap.set(key, event);
    }
  });

  // Convert map back to array of event objects
  const uniqueEvents = Array.from(uniqueEventsMap.values());

// --- DEBUG LOG START ---
  logger.warn(`${logPrefix} [DEBUG] Saving ${uniqueEvents.length} unique events to DB.`);
  if (uniqueEvents.length > 0) {
     logger.warn(`${logPrefix} [DEBUG] First unique event to save: ${JSON.stringify(uniqueEvents[0])}`);
  }
  // --- DEBUG LOG END ---

  // Save the de-duplicated list back to the DB (early for frontend use)
  try {
    await sql`
      UPDATE playlist_jobs 
      SET events_data = ${sql.json(uniqueEvents)}
      WHERE id = ${jobId};
    `;
  } catch (saveErr) {
    logger.warn(`${logPrefix} Failed to save initial events data: ${saveErr.message}`);
  }

  await updateJobLog(jobId, `Found ${uniqueEvents.length} artists in ${city} on ${prettyDate}${nameContext}`, 0, uniqueEvents.length);
  logger.info(`${logPrefix} Found ${rawEventsList.length} total events, de-duplicated and filtered to ${uniqueEvents.length} unique artists`);

  // await updateJobLog(jobId, `De-duplicated list. Processing ${uniqueEvents.length} unique artists...`, 0, uniqueEvents.length);

  // --- SYNONYM MAP ---
  const genreSynonymMap = {
    'hip hop': ['rap'],
    'r&b': ['soul'],
    'electronic': [
      'edm', 'techno', 'house', 'dubstep', 'trance', 
      'psytrance', 'downtempo', 'bass music', 'riddim'
    ],
    'punk': ['hardcore', 'post-punk', 'screamo', 'emo'],
    'latin': [
      'reggaeton', 'cumbia', 'banda', 'sertanejo', 
      'dembow', 'grupera', 'duranguense', 'piseiro'
    ],
    'blues': ['boogie-woogie'],
    'folk': ['americana'],
    'classical': ['orchestral']
  };

  // Create a new, expanded list of genres to filter
  let expandedExcludedGenres = [...(excludedGenres || [])];

  if (excludedGenres) {
    excludedGenres.forEach(genre => {
      if (genreSynonymMap[genre]) {
        expandedExcludedGenres = [
          ...expandedExcludedGenres, 
          ...genreSynonymMap[genre]
        ];
      }
    });
  }
// --- END: SYNONYM MAP ---

  // Initialize array to hold artist results
  const processedArtistIds = new Set(); // deal with for duplicate Spotify IDs
  const retryCounts = {}; // Object to track retries per artist

  // track total number of tracks added to see if we added any at all
  let tracksAddedCount = 0;

  // --- BATCHING SYSTEM FOR OPTION A ---
  // Collect track URIs in batches to reduce API calls
  // Spotify allows up to 100 tracks per POST request
  const BATCH_SIZE = 100;
  const trackBatch = []; // Array of track URIs to add
  const batchArtistNames = []; // Track which artists are in current batch (for error handling)
  
  // Helper function to flush the current batch to Spotify
  const flushBatch = async () => {
    if (trackBatch.length === 0) return;
    
    const MAX_BATCH_RETRIES = 3;
    let retryCount = 0;
    let success = false;
    
    while (retryCount < MAX_BATCH_RETRIES && !success) {
      try {
        // Rate limiting: Check global rate limit BEFORE each retry attempt
        await waitForRateLimit(logPrefix);
        
        // Additional pre-emptive delay to prevent hitting rate limits
        await sleep(SPOTIFY_API_DELAY_MS);
        
        await axios.post(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
          { uris: trackBatch },
          axiosConfig
        );
        
        logger.info(`${logPrefix} [BATCH] Successfully added ${trackBatch.length} tracks to playlist (${batchArtistNames.length} artists)`);
        tracksAddedCount += trackBatch.length;
        success = true;
        
        // Clear the batch
        trackBatch.length = 0;
        batchArtistNames.length = 0;
      } catch (batchError) {
        const batchStatus = batchError.response ? batchError.response.status : null;
        retryCount++;
        
        // Check if it's a retryable error (429, 5xx)
        const isRetryable = batchStatus === 429 || (batchStatus >= 500 && batchStatus < 600);
        
        if (isRetryable && retryCount < MAX_BATCH_RETRIES) {
          if (batchStatus === 429) {
            // Set global rate limit so all workers pause
            const retryAfterSeconds = batchError.response?.headers?.['retry-after'] || 
                                     batchError.response?.headers?.['Retry-After'] || 5;
            logger.warn(`${logPrefix} [RATE-LIMIT] Batch POST 429 - Headers: ${JSON.stringify(batchError.response?.headers)}`);
            setGlobalRateLimit(retryAfterSeconds, logPrefix);
            
            // Wait for global rate limit (this coordinates across all workers)
            await waitForRateLimit(logPrefix);
            
            logger.warn(`${logPrefix} [BATCH] Retrying after global rate limit cleared. Retry ${retryCount}/${MAX_BATCH_RETRIES}...`);
          } else {
            // For 5xx errors, use standard exponential backoff
            const waitMs = Math.max(3000 * Math.pow(2, retryCount - 1), 3000);
            logger.warn(`${logPrefix} [BATCH] Failed to add ${trackBatch.length} tracks. Status: ${batchStatus}. Retry ${retryCount}/${MAX_BATCH_RETRIES} in ${waitMs/1000}s...`);
            await sleep(waitMs);
          }
          // Continue loop to retry
        } else {
          // Not retryable or out of retries - log failure
          logger.error(`${logPrefix} [BATCH] Failed to add ${trackBatch.length} tracks (${batchArtistNames.length} artists). Status: ${batchStatus}. Giving up after ${retryCount} attempts.`);
          
          // Log batch failure to frontend so user knows some tracks may be missing
          const failedArtistsList = batchArtistNames.slice(0, 5).join(', '); // Show first 5 artists
          const moreArtists = batchArtistNames.length > 5 ? ` and ${batchArtistNames.length - 5} more` : '';
          await updateJobLog(
            jobId,
            `WARNING: Failed to add tracks for ${batchArtistNames.length} artists (${failedArtistsList}${moreArtists}). Some tracks may be missing from playlist.`,
            null, // Don't update progress count
            null
          );
          
          // Clear the batch even on failure to prevent retrying the same batch
          trackBatch.length = 0;
          batchArtistNames.length = 0;
          break; // Exit retry loop
        }
      }
    }
  };
  // --- END BATCHING SYSTEM ---

  // --- Loop over uniqueEvents objects ---
  for (let i = 0; i < uniqueEvents.length; i++) {
    const eventObj = uniqueEvents[i];
    const artistName = eventObj.name; // Extract string name for Spotify search

    // Log memory usage every 5 artists
    if (i % 5 === 0) {
      const memoryUsage = process.memoryUsage();
      // Heap Used is the most relevant metric for your code's object usage
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100;
      const rssMB = Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100;
      
      logger.debug(`${logPrefix} [MEMORY] Artist ${i}/${uniqueEvents.length} - Heap: ${heapUsedMB} MB | RSS: ${rssMB} MB`);
    }
    
    // await updateJobLog(jobId, `Checking Spotify for: "${artistName}"...`, i, uniqueEvents.length);
    logger.info(`${logPrefix} [${i + 1}/${uniqueEvents.length}] Processing artist: "${artistName}"`);
    
    // Rate limiting: Add delay before making API call (except on retries)
    // Rate limiting: Check global rate limit BEFORE artist search (most frequent call)
    await waitForRateLimit(logPrefix);
    
    if (i > 0 || retryCounts[artistName] === undefined) {
      await sleep(SPOTIFY_API_DELAY_MS);
    }
    
    try {
      const searchResponse = await axios.get(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );

      const potentialMatches = searchResponse.data.artists.items;
      if (potentialMatches.length === 0) {
        logger.info(`${logPrefix}   -> No Spotify results for "${artistName}".`);
        await updateJobLog(jobId, `SKIPPED:${artistName} (Not found)`, i, uniqueEvents.length);
        continue;
      }

      let bestMatch = null;
      // Find exact match
      for (const match of potentialMatches) {
        if (match.name.toLowerCase() === artistName.toLowerCase()) {
          bestMatch = match;
          break;
        }
      }

      let spotifyArtistId = null;

      if (bestMatch) {
        // Found Exact Match
        spotifyArtistId = bestMatch.id;
        logger.info(`${logPrefix}   -> Found Exact Match: "${bestMatch.name}" (ID: ${spotifyArtistId}) & genres: ${bestMatch.genres.join(', ')}`);
      } else {
        // No Exact Match, Check Similarity
        let closestMatch = null;
        let minDistance = Infinity;

        for (const match of potentialMatches) {
          const distance = levenshtein.get(artistName.toLowerCase(), match.name.toLowerCase());
          if (distance < minDistance) {
            minDistance = distance;
            closestMatch = match;
          }
        }
        
        const SIMILARITY_THRESHOLD = 1;
        if (closestMatch && minDistance <= SIMILARITY_THRESHOLD) {
          // Found a close enough match
          bestMatch = closestMatch;
          spotifyArtistId = bestMatch.id;
          logger.info(`${logPrefix}   -> Found Fuzzy Match: "${bestMatch.name}" (ID: ${spotifyArtistId}, Dist: ${minDistance}) & genres: ${bestMatch.genres.join(', ')}`);
        } else {
          // No good match found
          logger.warn(`${logPrefix} No close match for "${artistName}". Skipping.`);
          await updateJobLog(jobId, `SKIPPED:${artistName} (Not found)`, i, uniqueEvents.length);
        }
      }

      // Genre Filtering Logic
      if (excludedGenres && excludedGenres.length > 0 && bestMatch && bestMatch.genres && bestMatch.genres.length > 0) {
        // Check if *any* of the artist's genres match *any* of the excluded genres
        const hasExcludedGenre = excludedGenres.some(excludedGenre => 
          bestMatch.genres.some(artistGenre => 
            artistGenre.toLowerCase().includes(excludedGenre.toLowerCase())
          )
        );

        if (hasExcludedGenre) {
          // This artist MATCHES the exclusion list, so we SKIP them.
          // await updateJobLog(jobId, `  -> Skipped "${bestMatch.name}" (Genre: ${bestMatch.genres[0]})`);
          logger.info(`${logPrefix}   -> SKIPPING: Artist "${bestMatch.name}" has an excluded genre. (${bestMatch.genres.join(', ')})`);
          await updateJobLog(jobId, `SKIPPED:${bestMatch.name} (Genre: ${bestMatch.genres[0]})`, i, uniqueEvents.length);
          spotifyArtistId = null; // Set to null to skip track-adding
        }
    }

      // If we have a match, add tracks
      if (spotifyArtistId) {
        // Check if we've already added tracks for this exact Spotify ID
        if (processedArtistIds.has(spotifyArtistId)) {
          logger.info(`${logPrefix} Already processed artist ID ${spotifyArtistId} (from a duplicate). Skipping track add.`);
          continue;
        }
        // NOTE: We do NOT add to processedArtistIds here. We only add it after successfully
        // getting tracks and adding them to the batch. This allows retries to work correctly
        // if we get a 429 error when fetching top tracks.
        
        // Rate limiting: Check global rate limit BEFORE top-tracks API call
        await waitForRateLimit(logPrefix);
        
        // Additional pre-emptive delay to prevent hitting rate limits
        await sleep(SPOTIFY_API_DELAY_MS);
        
        const topTracksResponse = await axios.get(
          `https://api.spotify.com/v1/artists/${spotifyArtistId}/top-tracks`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }
        );
        const tracksToAdd = topTracksResponse.data.tracks.slice(0, number_of_songs);
        const trackUris = tracksToAdd.map(track => track.uri);

        if (trackUris.length > 0) {
          // Use bestMatch.name for the log since artistName can be slightly different
          const logName = artistName;
          
          // OPTION A: Log artist immediately (before batching POST)
          // This makes artists appear in feed faster
          await updateJobLog(jobId, `ARTIST:${logName}`, i, uniqueEvents.length);
          logger.info(`${logPrefix}   -> Found ${trackUris.length} tracks for "${logName}". Adding to batch...`);

          // Add tracks to batch
          trackBatch.push(...trackUris);
          batchArtistNames.push(logName);
          
          // NOW we can mark this artist as processed, since we successfully got tracks
          processedArtistIds.add(spotifyArtistId);

          // If batch is full, flush it immediately
          if (trackBatch.length >= BATCH_SIZE) {
            await flushBatch();
          }
        } else {
          logger.info(`${logPrefix}   -> Found artist, but they have no top tracks. Skipping track add.`);
          await updateJobLog(jobId, `SKIPPED:${bestMatch.name} (No tracks)`, i, uniqueEvents.length);
          // Mark as processed even if no tracks, to avoid retrying artists with no tracks
          processedArtistIds.add(spotifyArtistId);
        }
      }
    } catch (error) {
      const status = error.response ? error.response.status : null;
      // A list of all temporary error codes that we should retry
      const retryableErrorCodes = [
        429, // Rate Limit
        500, // Internal Server Error
        502, // Bad Gateway
        503, // Service Unavailable
        504  // Gateway Timeout
      ];

      if (status && retryableErrorCodes.includes(status)) {
        // It's a retryable error!
        const currentRetries = retryCounts[artistName] || 0;
        const MAX_RETRIES = 3;

        if (currentRetries < MAX_RETRIES) {
          // We have retries left, so try again
          retryCounts[artistName] = currentRetries + 1; // Increment retry count
          
          let waitMs = 3000; // Default 3 second wait for 5xx errors
          let waitReason = `${status} server error`;

          if (status === 429) {
            // It's a rate-limit error - set global rate limit so all workers pause
            const retryAfterSeconds = error.response?.headers?.['retry-after'] || 
                                     error.response?.headers?.['Retry-After'] || 5;
            logger.warn(`${logPrefix} [RATE-LIMIT] Artist search 429 - Headers: ${JSON.stringify(error.response?.headers)}`);
            setGlobalRateLimit(retryAfterSeconds, logPrefix);
            
            // Wait for global rate limit (this coordinates across all workers)
            await waitForRateLimit(logPrefix);
            
            waitReason = `429 rate limit (global coordination)`;
            waitMs = 0; // Already waited in waitForRateLimit
          } else {
            // For 5xx errors, use standard exponential backoff
            const exponentialMultiplier = Math.pow(2, currentRetries);
            waitMs = Math.max(3000 * exponentialMultiplier, 3000);
          }

          if (waitMs > 0) {
            logger.warn(`${logPrefix} Spotify ${waitReason}. (Retry ${currentRetries + 1}/${MAX_RETRIES}) Waiting ${waitMs / 1000}s for artist "${artistName}"...`);
            await sleep(waitMs);
          } else {
            logger.warn(`${logPrefix} Spotify ${waitReason}. (Retry ${currentRetries + 1}/${MAX_RETRIES}) Retrying artist "${artistName}" after global rate limit cleared...`);
          }
          
          i--; // Rewind the loop to retry
          logger.info(`${logPrefix} Retrying artist "${artistName}"...`);
        } else {
          // --- We're out of retries. Give up on this artist. ---
          logger.error(`${logPrefix} Artist "${artistName}" failed after ${MAX_RETRIES} retries. Skipping.`);
        }
      } else {
        // It was a different, non-retryable error (like 404, 401)
        // Or a non-axios error. Log it and move on.
        logger.error(`${logPrefix} Error processing artist "${artistName}":`, error.message);
      }
    }
  }

  // Flush any remaining tracks in the batch before completing
  if (trackBatch.length > 0) {
    logger.info(`${logPrefix} [BATCH] Flushing final batch of ${trackBatch.length} tracks (${batchArtistNames.length} artists)...`);
    await flushBatch();
  }

  await updateJobLog(jobId, `Curation complete for ${city} on ${prettyDate}`, uniqueEvents.length, uniqueEvents.length);
  logger.info(`${logPrefix} Curation complete. Total tracks added to playlist: ${tracksAddedCount}`);
  
  // Check if we actually added any songs
  // IMPORTANT: Distinguish between "no artists found" vs "artists found but batch failed"
  if (tracksAddedCount === 0) {
    // Check if we actually found artists (but failed to add tracks)
    if (uniqueEvents.length > 0) {
      // We found artists but failed to add tracks (likely batch failures)
      // Still return the playlist ID so user can see what was attempted
      // The warning messages in logs will inform them of the issue
      logger.warn(`${logPrefix} Found ${uniqueEvents.length} artists but no tracks were successfully added. Playlist may be empty or incomplete.`);
      // Return playlistId anyway - let the user see the (possibly empty) playlist
      // The warnings in the feed will explain what happened
      return { playlistId, events: uniqueEvents };
    } else {
      // No artists found at all - this is a true "no artists" failure
      logger.warn(`${logPrefix} No artists found for playlist ${playlistId}. Deleting empty playlist...`);
      try {
        // We must "unfollow" (delete) the playlist from the master account.
        await axios.delete(
          `https://api.spotify.com/v1/playlists/${playlistId}/followers`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        logger.warn(`${logPrefix} Successfully deleted empty playlist ${playlistId}.`);
      } catch (deleteError) {
        logger.error(`${logPrefix} CRITICAL! Failed to delete empty playlist ${playlistId}.`, deleteError.message);
        // Don't stop, just let it return null.
      }
      
      // Return null, which our worker will see as a failure.
      return { playlistId: null, events: [] };
    }
  }
  return { playlistId, events: uniqueEvents };

}

/**
 * Finds one 'pending' job, runs it, and updates the DB.
 * Designed to be called repeatedly by a loop.
 */
async function processJobQueue(workerId) {
  let job; // declared outside the 'try' so we can use it in 'catch'
  const logPrefix = `[Worker ${workerId}]`;
  logger.superDebug(`${logPrefix} (1/7): processJobQueue started.`);

  try {
    // find any job that's been "building" for too long
    // (e.g., if the server crashed) and mark it as 'failed'.
    try {
      logger.superDebug(`${logPrefix} (2/7): Checking for zombie jobs...`);
      const zombieJobs = await sql`
        UPDATE playlist_jobs 
        SET 
          status = 'failed', 
          error_message = 'Build timed out and was reset'
        WHERE status = 'building'
        AND updated_at < NOW() - INTERVAL '30 minutes'
        RETURNING id;
      `;

      if (zombieJobs.length > 0) {
        logger.warn(`${logPrefix} Found and reset ${zombieJobs.length} zombie job(s).`);
      }
      logger.superDebug(`${logPrefix} (3/7): Zombie check complete.`);
    } catch (reaperError) {
      // If this fails, the DB is probably down. Log it and stop.
      logger.error(`${logPrefix} CRITICAL! Zombie reaper FAILED:`, reaperError.message);
      return; // Stop the worker run
    }

    logger.superDebug(`${logPrefix} (4/7): Looking for a pending job...`);
    // Find and "Lock" a Job
    // Find a pending job and update its status
    // This prevents two workers from accidentally grabbing the same job.
    job = await sql.begin(async sql => {
      
      // Find the oldest 'pending' job.
      const pendingJobs = await sql`
        SELECT * FROM playlist_jobs 
        WHERE status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT 1
        FOR UPDATE SKIP LOCKED;
      `;

      if (pendingJobs.length === 0) {
        return null; // No jobs to do.
      }

      const jobToProcess = pendingJobs[0];

      // "Lock" the job by updating its status
      const lockedJob = await sql`
        UPDATE playlist_jobs 
        SET status = 'building'
        WHERE id = ${jobToProcess.id} 
        RETURNING *;
      `;
      
      return lockedJob[0];
    });

    if (!job) {
      logger.superDebug(`${logPrefix} (5/7): No pending jobs found.`);
      return; // No jobs to do, so just stop here.
    }

    // Process the Job
    logger.info(`${logPrefix} (6/7): Picked up job ${job.id}. Calling runCurationLogic on "${job.search_city}" on ${job.search_date}`);
    
    const accessToken = await getMasterAccessToken();

    // Run our curation logic with the job's data
    const { playlistId, events } = await runCurationLogic(
      job.id,
      job.search_city,
      job.search_date,
      job.number_of_songs,
      accessToken,
      job.latitude,
      job.longitude,
      job.excluded_genres,
      job.min_start_time,
      job.max_start_time,
      workerId
    );

    // Handle Success
    logger.info(`${logPrefix} (7/7): Curation logic complete for job ${job.id}. PlaylistID: ${playlistId}`);
    if (playlistId) {
    await sql`
      UPDATE playlist_jobs 
      SET
        status = 'complete',
        playlist_id = ${playlistId},
        events_data = ${sql.json(events)},
        updated_at = NOW()
      WHERE id = ${job.id};
    `;

    // Check for pending email requests and send them
    try {
      const pendingEmails = await sql`
        SELECT * FROM email_requests 
        WHERE job_id = ${job.id} AND status = 'pending'
      `;

      if (pendingEmails.length > 0) {
        logger.info(`${logPrefix} Found ${pendingEmails.length} pending email request(s) for job ${job.id}. Sending emails...`);
        
        for (const emailRequest of pendingEmails) {
          try {
            const emailResult = await sendPlaylistEmail({
              to: emailRequest.email,
              playlistId: playlistId,
              cityName: job.search_city,
              playlistDate: job.search_date,
              artistCount: events.length,
              excludedGenres: job.excluded_genres,
              minStartTime: job.min_start_time,
              maxStartTime: job.max_start_time
            });

            if (emailResult.success) {
              // Update email request as sent
              await sql`
                UPDATE email_requests 
                SET status = 'sent', sent_at = NOW(), updated_at = NOW()
                WHERE id = ${emailRequest.id}
              `;
              logger.info(`${logPrefix} Successfully sent deferred email to ${emailRequest.email} for job ${job.id}`);
            } else {
              // Update email request as failed
              await sql`
                UPDATE email_requests 
                SET status = 'failed', error_message = ${emailResult.error}, updated_at = NOW()
                WHERE id = ${emailRequest.id}
              `;
              logger.error(`${logPrefix} Failed to send deferred email to ${emailRequest.email}: ${emailResult.error}`);
            }
          } catch (emailError) {
            // Update email request as failed
            await sql`
              UPDATE email_requests 
              SET status = 'failed', error_message = ${emailError.message}, updated_at = NOW()
              WHERE id = ${emailRequest.id}
            `;
            logger.error(`${logPrefix} Error sending deferred email to ${emailRequest.email}: ${emailError.message}`);
          }
        }
      }
    } catch (emailCheckError) {
      // Don't fail the job if email sending fails - just log it
      logger.warn(`${logPrefix} Error checking for pending emails: ${emailCheckError.message}`);
    }

    } else {
      logger.warn(`${logPrefix} Job ${job.id} found no artists. Marking as 'failed'.`);
      await sql`
        UPDATE playlist_jobs 
        SET status = 'failed', error_message = 'No artists were found for this city and date.'
        WHERE id = ${job.id};
      `;
    }

  } catch (error) {
    // Handle Failure
    logger.error(`${logPrefix} CRITICAL FAILURE for job ${job ? job.id : 'unknown'}. Full Error:`, error);
    if (job) {
      // We are already in a failed state.
      // If we can't log the error to the DB just don't crash.
      try {
        await sql`
          UPDATE playlist_jobs 
          SET 
            status = 'failed', 
            error_message = ${error.message}
          WHERE id = ${job.id};
        `;
        logger.info(`${logPrefix} Successfully logged failure for job ${job.id} to DB.`);
      } catch (dbError) {
        logger.error(`${logPrefix} CRITICAL! FAILED TO LOG FAILURE for job ${job.id}. DB connection is down.`);
        logger.error(`${logPrefix} Original error:`, error.message);
        logger.error(`${logPrefix} DB log error:`, dbError.message);
      }
    }
  }
}

// Main API Routes

/**
 * Fire-and-Forget Keep-Alive Route.
 * Designed for free-tier cron jobs (cron-jobs.org).
 * 1. Responds immediately (preventing cron timeout).
 * 2. Pings DB in background to keep it awake.
 */
app.get('/api/keep-alive', (req, res) => {
  // 1. Respond INSTANTLY to satisfy the cron job
  res.status(200).send('Server is awake. Pinging DB in background...');

  // 2. Background Task (Fire and Forget)
  // We do NOT await this, so the response is not blocked.
  (async () => {
    try {
      logger.debug('[KEEP-ALIVE] Background DB ping starting...');
      // A simple query to wake up Supabase
      await sql`SELECT 1`;
      logger.debug('[KEEP-ALIVE] DB is awake and responsive.');
    } catch (err) {
      // It's okay if this fails occasionally during a hard sleep.
      // The cron job will just try again in 14 mins.
      logger.warn('[KEEP-ALIVE] DB ping failed:', err.message);
    }
  })();
});

/**
 * Health check route.
 * Wake up supabase and confirm DB connectivity.
 */
app.get('/', async (req, res) => {
  const MAX_RETRIES = 4;
  const RETRY_DELAY = 15000; // 15 seconds

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      logger.info(`DB Ping: Attempt ${i}/${MAX_RETRIES}...`);
      await sql`SELECT 1;`;
      return res.json({ message: 'Server and Database are up and running!' });
    
    } catch (error) {
      logger.warn(`DB Ping: Attempt ${i} failed. DB is still waking up...`);
      if (i === MAX_RETRIES) {
        logger.error('CRITICAL: Health check ping to database FAILED after all retries.');
        return res.status(503).json({ error: 'Database connection failed.' });
      }
      
      // Wait 15 seconds before the next loop iteration
      await sleep(RETRY_DELAY);
    }
  }
});

/**
 * Autocomplete route for cities.
 * Uses the trigram index on the 'cities' table for fast, fuzzy search.
 */
app.get('/api/search-cities', async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter: q' });
  }

  try {
    // Calculate similarity
    // We use similarity() to find rows that are "like" the query.
    // We select the name and the similarity score itself, ordered by highest.
    const results = await sql`
      SELECT
        name,
        latitude,
        longitude,
        population,
        similarity(name, ${q}) AS sml
      FROM cities
      WHERE similarity(name, ${q}) > 0.1
      ORDER BY
        (name ILIKE ${q + '%'}) DESC,
        sml DESC,
        population::bigint DESC NULLS LAST
      LIMIT 10;
    `;
    
    // Format and return the results
    const suggestions = results.map(r => ({
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      population: r.population
    }));

    // Re-sort results *by population only*
    const containsQuery = (name, q) =>
      name.toLowerCase().includes(q.toLowerCase());

    const startsWithQuery = (name, q) =>
      name.toLowerCase().startsWith(q.toLowerCase());

    suggestions.sort((a, b) => {
      const aContains = containsQuery(a.name, q);
      const bContains = containsQuery(b.name, q);

      // 1. Containing matches first
      if (aContains && !bContains) return -1;
      if (!aContains && bContains) return 1;

      // 2. Then prefix matches
      const aPrefix = startsWithQuery(a.name, q);
      const bPrefix = startsWithQuery(b.name, q);

      if (aPrefix && !bPrefix) return -1;
      if (!aPrefix && bPrefix) return 1;

      // 3. Otherwise (same category): compare population
      return (b.population || 0) - (a.population || 0);
    });

    const debugSuggestions = suggestions.map(s => `${s.name} (Pop: ${s.population ? s.population.toLocaleString() : 'NULL'})`);
    logger.debug(`Search Cities: top ${suggestions.length} suggestions for query "${q}":\n${debugSuggestions.join('\n')}`);

    res.json(suggestions);

  } catch (error) {
    logger.error('Error in /api/search-cities: FULL ERROR OBJECT:');
    logger.error(error);
    res.status(500).json({ error: 'Error searching for cities.' });
  }
});

app.get('/api/city-from-coords', async (req, res) => {
  const { lat, lon } = req.query;
  
  if(!lat || !lon) {
    return res.status(400).json({ error: 'Missing required query parameters: lat and lon' });
  }
  // convert lat and long to numbers
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  // check if conversion was successful
  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({ error: 'Invalid latitude or longitude values.' });
  }
  try {
    // PostGIS query for nearest city
    const results = await sql`
      SELECT name, latitude, longitude
      FROM cities
      ORDER BY geography <-> ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
      LIMIT 1;
    `;

    if (results.length === 0) {
      return res.status(404).json({ error: 'No cities found in the database.' });
    }
    
    // send result back to frontend
    const city = results[0];
    return res.json({
      name: city.name,
      latitude: city.latitude,
      longitude: city.longitude
    });

  } catch (error) {
    logger.error('Error in /api/city-from-coords:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * Main curation route.
 * Validates input and creates a new 'pending' job in the DB.
 */
app.get('/api/playlists', async (req, res) => {
  // Validate Input
  const { city, date, lat, lon, genres, minStartTime, maxStartTime } = req.query;
  const number_of_songs = 1;

  // Verify the user (if a token exists)
  const ownerId = await getUserIdFromRequest(req);
  if (ownerId) {
    logger.info(`Request from authenticated user: ${ownerId}`);
  } else {
    logger.info(`Request from anonymous/unauthenticated user.`);
  }

  if (!city || !date || !lat || !lon) {
    return res.status(400).json({ error: 'Missing required query parameters: city, date, lat, and lon' });
  }

  // Convert lat/lon to numbers for safety
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  // Convert the comma-separated string of back into an array for the DB
  // If 'genres' is undefined or "", this will become 'null'
  const genresArray = genres ? genres.split(',') : null;

  // Check for an Existing Job
  // Let's not create duplicate jobs. If a user spam-clicks,
  // just return the job that's already pending or complete.
  // We fetch 'updated_at' to check for staleness.
  try {
    const existingJob = await sql`
      SELECT id, status, playlist_id, updated_at 
      FROM playlist_jobs 
      WHERE 
        search_city = ${city} AND 
        search_date = ${date} AND
        number_of_songs = ${number_of_songs} AND
        excluded_genres IS NOT DISTINCT FROM ${genresArray} AND
        min_start_time = ${minStartTime || 0} AND
        max_start_time = ${maxStartTime || 24}
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    if (existingJob.length > 0) {
      const job = existingJob[0];

      // If it says "building" but hasn't been updated in 5 minutes, it's a zombie.
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const lastUpdate = new Date(job.updated_at);
      
      if (job.status === 'building' && lastUpdate < fiveMinutesAgo) {
        logger.warn(`Cache HIT (Job ${job.id}): Job is 'building' but stale (>5 mins). Marking failed and creating new job.`);
        
        // Mark the old one failed so we don't accidentally pick it up again
        await sql`
          UPDATE playlist_jobs 
          SET status = 'failed', error_message = 'Stale job detected in cache' 
          WHERE id = ${job.id}
        `;
        // We do NOT return here. We let the code fall through to "Create a New Job" below.
        
      } else if (job.status === 'failed') {
        // If the job failed, allow retry by creating a new job
        logger.info(`Cache HIT (Job ${job.id}): Previous job failed. Creating new job to allow retry.`);
        // Fall through to create a new job below
        
      } else {
        // It's a valid running job or a completed job. Return it.
        logger.info(`Cache HIT (Job): Found existing job ${job.id} with status: ${job.status}`);
        return res.json({ jobId: job.id });
      }
    }
    
    // Create a New Job
    // Add the 'excluded_genres' array to your INSERT
    logger.info(`Cache MISS (Job): No job found for ${city} on ${date} excluding: ${genres}. Creating new job...`);
    
    const newJob = await sql`
      INSERT INTO playlist_jobs (
        search_city,
        search_date,
        latitude,
        longitude,
        number_of_songs,
        excluded_genres,
        min_start_time,
        max_start_time,
        updated_at,
        owner_id
      ) VALUES (
        ${city},
        ${date},
        ${latitude},
        ${longitude},
        ${number_of_songs},
        ${genresArray},
        ${minStartTime || 0},
        ${maxStartTime || 24},
        NOW(),
        ${ownerId}
      )
      RETURNING id;
    `;

    const jobId = newJob[0].id;
    logger.info(`Successfully created new job with ID: ${jobId}`);

    // Send the job ID back to the user immediately
    return res.status(202).json({ jobId: jobId }); // 202 means "Accepted"

  } catch (error) {
    logger.error('Error in /api/playlists (job creation):', error);
    return res.status(500).json({ error: 'Error creating new playlist job.' });
  }
});

/**
 * Polls for the status of a job.
 * The frontend will call this route every 5 seconds.
 */
app.get('/api/playlists/status', async (req, res) => {
  const { jobId } = req.query;

  if (!jobId) {
    return res.status(400).json({ error: 'Missing required query parameter: jobId' });
  }

  try {
    const jobResult = await sql`
      SELECT 
        id,
        status, 
        playlist_id, 
        error_message, 
        log_history,
        total_artists,
        processed_artists,
        events_data,
        created_at
      FROM playlist_jobs 
      WHERE id = ${jobId};
    `;

    if (jobResult.length === 0) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const job = jobResult[0];

    // Calculate queue position: count how many pending jobs have a lower ID (were created before this one)
    // Using ID instead of created_at because IDs are sequential and unique, avoiding timestamp precision issues
    let queuePosition = 0;
    if (job.status === 'pending') {
      // First, let's get all pending jobs to debug
      const allPendingJobs = await sql`
        SELECT id, status, created_at
        FROM playlist_jobs
        WHERE status = 'pending'
        ORDER BY id ASC
      `;
      
      const queueCount = await sql`
        SELECT COUNT(*) as count
        FROM playlist_jobs
        WHERE status = 'pending'
        AND id < ${job.id}
      `;
      queuePosition = Number(queueCount[0]?.count) || 0;
      
      // Debug logging to verify queue position calculation
      logger.warn(`[QUEUE-POS] Job ${job.id}: Total pending jobs: ${allPendingJobs.length}. Jobs with lower ID: ${queuePosition}. Display position: ${queuePosition + 1}`);
      if (allPendingJobs.length > 0) {
        logger.warn(`[QUEUE-POS] All pending job IDs: ${allPendingJobs.map(j => j.id).join(', ')}`);
      }
    }

    // Send the whole job status back to the frontend.
    // The frontend will decide what to do with this.
    res.json({
      status: job.status,
      playlistId: job.playlist_id,
      error: job.error_message,
      logs: job.log_history || [],
      progress: {
        total: job.total_artists || 0,
        current: job.processed_artists || 0
      },
      events: job.events_data || [],
      queuePosition: queuePosition
    });

  } catch (error) {
    logger.error('Error in /api/playlists/status:', error);
    return res.status(500).json({ error: 'Error fetching job status.' });
  }
});

/**
 * Save OR Update a playlist.
 * Logic: If the user already has a saved playlist for this City + Date, 
 * we overwrite it (Update). Otherwise, we create a new one (Insert).
 */
app.post('/api/save-playlist', async (req, res) => {
  const { jobId } = req.body;
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!jobId) return res.status(400).json({ error: 'Missing required field: jobId' });

  try {
    // 1. Fetch the Job Details
    const jobs = await sql`SELECT * FROM playlist_jobs WHERE id = ${jobId}`;
    if (jobs.length === 0) return res.status(404).json({ error: 'Job not found.' });
    const job = jobs[0];

    // 2. Check for EXISTING playlist (Same User + City + Date)
    // We strictly enforce 1 saved playlist per City/Date per User.
    const existing = await sql`
      SELECT id FROM saved_playlists 
      WHERE user_id = ${userId} 
      AND city_name = ${job.search_city} 
      AND playlist_date = ${job.search_date}
    `;

    const displayName = `${job.search_city} - ${job.search_date}`;

    if (existing.length > 0) {
      // --- UPDATE EXISTING ---
      const savedId = existing[0].id;
      logger.info(`Updating existing playlist ${savedId} for user ${userId}`);
      
      await sql`
        UPDATE saved_playlists SET
          original_job_id = ${job.id},
          spotify_playlist_id = ${job.playlist_id},
          name = ${displayName},
          events_snapshot = ${job.events_data},
          min_start_time = ${job.min_start_time},
          max_start_time = ${job.max_start_time},
          excluded_genres = ${job.excluded_genres},
          latitude = ${job.latitude},
          longitude = ${job.longitude},
          created_at = NOW() -- Bump to top of list
        WHERE id = ${savedId}
      `;
      return res.json({ success: true, savedId: savedId, action: 'updated' });
    } else {
      // --- INSERT NEW ---
      const saved = await sql`
        INSERT INTO saved_playlists (
          user_id,
          original_job_id,
          spotify_playlist_id,
          name,
          city_name,
          playlist_date,
          events_snapshot,
          min_start_time,
          max_start_time,
          excluded_genres,
          latitude,
          longitude
        ) VALUES (
          ${userId}, ${job.id},
          ${job.playlist_id},
          ${displayName},
          ${job.search_city},
          ${job.search_date},
          ${job.events_data},
          ${job.min_start_time},
          ${job.max_start_time},
          ${job.excluded_genres},
          ${job.latitude},
          ${job.longitude}
        )
        RETURNING id;
      `;
      return res.json({ success: true, savedId: saved[0].id, action: 'created' });
    }
  } catch (error) {
    logger.error('Error in /api/save-playlist:', error);
    return res.status(500).json({ error: 'Failed to save playlist.' });
  }
});

/**
 * Get all saved playlists for the authenticated user.
 */
app.get('/api/my-playlists', async (req, res) => {
  // 1. Verify Auth
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 2. Fetch from DB
    // We order by 'created_at' descending so the newest ones show up top.
    const playlists = await sql`
      SELECT 
        id,
        name,
        city_name,
        playlist_date,
        spotify_playlist_id,
        created_at,
        events_snapshot,
        -- New columns for "Edit/Update" functionality
        min_start_time,
        max_start_time,
        excluded_genres
      FROM saved_playlists 
      WHERE user_id = ${userId}
      ORDER BY created_at DESC;
    `;

    return res.json(playlists);

  } catch (error) {
    logger.error('Error in /api/my-playlists:', error);
    return res.status(500).json({ error: 'Failed to fetch library.' });
  }
});

/**
 * Delete a saved playlist.
 */
app.delete('/api/my-playlists/:id', async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;

  try {
    const result = await sql`
      DELETE FROM saved_playlists 
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id;
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Playlist not found or access denied.' });
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting playlist:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * REFRESH a saved playlist.
 * Re-runs the curation logic and updates the existing row.
 */
app.post('/api/my-playlists/:id/refresh', async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;

  try {
    // 1. Get the Saved Playlist
    const savedRows = await sql`
      SELECT * FROM saved_playlists WHERE id = ${id} AND user_id = ${userId}
    `;
    if (savedRows.length === 0) return res.status(404).json({ error: 'Playlist not found' });
    const saved = savedRows[0];

    // 2. Validate Coords
    if (!saved.latitude || !saved.longitude) {
      return res.status(400).json({ error: 'This saved playlist is outdated (missing coordinates). Please delete it and create a new one.' });
    }

    // 3. Create a "Shadow Job" for logging/tracking
    const newJob = await sql`
      INSERT INTO playlist_jobs (
        search_city, search_date, latitude, longitude, number_of_songs, 
        min_start_time, max_start_time, excluded_genres, 
        owner_id, status
      ) VALUES (
        ${saved.city_name}, ${saved.playlist_date}, 
        ${saved.latitude}, ${saved.longitude}, -- <--- FIX 1: Use 'saved.latitude'
        1,
        ${saved.min_start_time || 0}, ${saved.max_start_time || 24}, ${saved.excluded_genres},
        ${userId}, 'building'
      )
      RETURNING id;
    `;
    const jobId = newJob[0].id;

    // 4. Run the Logic
    const accessToken = await getMasterAccessToken();
    const { playlistId, events } = await runCurationLogic(
      jobId,
      saved.city_name,
      saved.playlist_date,
      1,
      accessToken,
      saved.latitude,   // <--- FIX 2: Use 'saved.latitude'
      saved.longitude,  // <--- FIX 3: Use 'saved.longitude'
      saved.excluded_genres,
      saved.min_start_time,
      saved.max_start_time,
      99 
    );

    // 5. Update the Saved Playlist with new results
    await sql`
      UPDATE saved_playlists SET
        spotify_playlist_id = ${playlistId},
        events_snapshot = ${sql.json(events)},
        original_job_id = ${jobId},
        updated_at = NOW() 
      WHERE id = ${id}
    `;

    // 6. Mark Job Complete
    await sql`UPDATE playlist_jobs SET status = 'complete', playlist_id = ${playlistId} WHERE id = ${jobId}`;

    // 7. Return the new data
    return res.json({ 
      success: true, 
      playlistId, 
      eventCount: events.length,
      events: events 
    });

  } catch (error) {
    logger.error(`Error refreshing playlist ${id}:`, error);
    return res.status(500).json({ error: 'Failed to refresh playlist.' });
  }
});

/**
 * Send playlist link via email.
 * Supports both immediate sending (if playlist is complete) and deferred sending (if playlist is still building).
 */
app.post('/api/email-playlist', async (req, res) => {
  const { playlistId, email, jobId } = req.body;
  const userId = await getUserIdFromRequest(req);

  // Validate required fields
  if (!playlistId) {
    return res.status(400).json({ error: 'Missing required field: playlistId' });
  }

  // Determine recipient email
  let recipientEmail = email;
  
  // If user is logged in, try to get their email from Supabase
  if (userId && !recipientEmail) {
    try {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(
        req.headers.authorization?.split(' ')[1]
      );
      if (!error && user?.email) {
        recipientEmail = user.email;
      }
    } catch (err) {
      logger.debug(`Could not get user email from token: ${err.message}`);
    }
  }

  // If still no email, require it in the request
  if (!recipientEmail) {
    return res.status(400).json({ error: 'Email address is required. Please provide an email or log in.' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recipientEmail)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }

  try {
    // Fetch job details if jobId is provided, otherwise try to find job by playlistId
    let job = null;
    if (jobId) {
      const jobs = await sql`SELECT * FROM playlist_jobs WHERE id = ${jobId}`;
      if (jobs.length > 0) job = jobs[0];
    } else {
      // Try to find job by playlist_id
      const jobs = await sql`SELECT * FROM playlist_jobs WHERE playlist_id = ${playlistId} ORDER BY created_at DESC LIMIT 1`;
      if (jobs.length > 0) job = jobs[0];
    }

    // Get playlist metadata from job or saved_playlists
    let cityName = 'Unknown City';
    let playlistDate = new Date().toISOString().split('T')[0];
    let artistCount = 0;
    let excludedGenres = null;
    let minStartTime = null;
    let maxStartTime = null;

    if (job) {
      cityName = job.search_city || cityName;
      playlistDate = job.search_date || playlistDate;
      artistCount = job.events_data?.length || 0;
      excludedGenres = job.excluded_genres;
      minStartTime = job.min_start_time;
      maxStartTime = job.max_start_time;
    } else {
      // Try to get from saved_playlists if user is logged in
      if (userId) {
        const saved = await sql`
          SELECT * FROM saved_playlists 
          WHERE spotify_playlist_id = ${playlistId} AND user_id = ${userId}
          ORDER BY created_at DESC LIMIT 1
        `;
        if (saved.length > 0) {
          cityName = saved[0].city_name || cityName;
          playlistDate = saved[0].playlist_date || playlistDate;
          artistCount = saved[0].events_snapshot?.length || 0;
          excludedGenres = saved[0].excluded_genres;
          minStartTime = saved[0].min_start_time;
          maxStartTime = saved[0].max_start_time;
        }
      }
    }

    // Check if playlist is ready (job is complete) or still building
    const isPlaylistReady = job ? (job.status === 'complete' && job.playlist_id === playlistId) : true;

    if (isPlaylistReady) {
      // Playlist is ready - send email immediately
      const emailResult = await sendPlaylistEmail({
        to: recipientEmail,
        playlistId,
        cityName,
        playlistDate,
        artistCount,
        excludedGenres,
        minStartTime,
        maxStartTime
      });

      if (!emailResult.success) {
        // Save failed request to database
        await sql`
          INSERT INTO email_requests (
            user_id, email, playlist_id, job_id, city_name, playlist_date,
            status, error_message
          ) VALUES (
            ${userId}, ${recipientEmail}, ${playlistId}, ${jobId || null},
            ${cityName}, ${playlistDate}, 'failed', ${emailResult.error}
          )
        `;
        
        logger.error(`Failed to send email to ${recipientEmail}: ${emailResult.error}`);
        return res.status(500).json({ 
          error: 'Failed to send email. Please try again or contact us at livemusiccurator@gmail.com' 
        });
      }

      // Save successful request to database
      await sql`
        INSERT INTO email_requests (
          user_id, email, playlist_id, job_id, city_name, playlist_date,
          status, sent_at
        ) VALUES (
          ${userId}, ${recipientEmail}, ${playlistId}, ${jobId || null},
          ${cityName}, ${playlistDate}, 'sent', NOW()
        )
      `;

      logger.info(`Successfully sent email to ${recipientEmail} for playlist ${playlistId}`);
      return res.json({ success: true, message: 'Email sent successfully' });

    } else {
      // Playlist is still building - save request as pending
      await sql`
        INSERT INTO email_requests (
          user_id, email, playlist_id, job_id, city_name, playlist_date,
          status
        ) VALUES (
          ${userId}, ${recipientEmail}, ${playlistId}, ${jobId || null},
          ${cityName}, ${playlistDate}, 'pending'
        )
        ON CONFLICT DO NOTHING
      `;

      logger.info(`Saved pending email request for ${recipientEmail} - will send when job ${jobId} completes`);
      return res.json({ 
        success: true, 
        message: 'Email request saved. You will receive the playlist link via email when it is ready.' 
      });
    }

  } catch (error) {
    logger.error('Error in /api/email-playlist:', error);
    return res.status(500).json({ 
      error: 'An error occurred. Please try again or contact us at livemusiccurator@gmail.com' 
    });
  }
});

/**
 * The Worker Loop
 * Starts the queue processing when the server boots.
 */
function startWorker() {
  const CONCURRENT_WORKERS = 16;
  logger.info(`Starting ${CONCURRENT_WORKERS} concurrent worker loops...`);

  // If the server just restarted, any job marked 'building' is actually dead.
  // We mark them failed so the UI doesn't get stuck on them.
  (async () => {
    try {
      const result = await sql`
        UPDATE playlist_jobs 
        SET status = 'failed', error_message = 'Server restarted during build'
        WHERE status = 'building';
      `;
      if (result.count > 0) {
        logger.warn(`[ZOMBIE HUNTER] Cleaned up ${result.count} zombie job(s) left in 'building' state.`);
      }
    } catch (err) {
      logger.error('[ZOMBIE HUNTER] Failed to clean zombie jobs:', err);
    }
  })();
  
  // --- Spawn Workers ---
  for (let i = 1; i <= CONCURRENT_WORKERS; i++) {
    const workerId = i;
    // We offset the start times slightly (2s, 4s, 6s, 8s) to prevent 
    // all 4 hitting the DB at the exact same millisecond on boot.
    setTimeout(() => {
      logger.info(`[Worker ${workerId}] Loop starting...`);
      
      let isRunning = false;
      
      const runLoop = async () => {
        if (isRunning) return; 
        isRunning = true;
        try {
          await processJobQueue(workerId); // Pass ID to queue
        } catch (err) {
          logger.error(`[Worker ${workerId}] Loop crashed:`, err);
        } finally {
          isRunning = false;
        }
      };

      // Run immediately, then every 10 seconds
      runLoop();
      setInterval(runLoop, 10000);

    }, i * 2000); 
  }
}

// Load rate limit state from database on startup (BEFORE starting workers)
// This prevents making requests immediately after restart if we were rate limited
loadRateLimitFromDatabase().then(() => {
  logger.info(`Rate limit state loaded from database (if any).`);
}).catch(err => {
  logger.warn(`Could not load rate limit state: ${err.message}`);
});

startWorker();

app.listen(port, '0.0.0.0', () => {
  logger.info(`Server listening on port ${port}. Access at http://localhost:${port}`);
});