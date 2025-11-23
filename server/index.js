// --- Imports ---
const express = require('express');
const axios = require('axios');
const postgres = require('postgres');
const levenshtein = require('fast-levenshtein');
const cors = require('cors');
const path = require('path'); 
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { scrapeBandsintown } = require('./utils/bandsintownScraper');
// --- Logger Configuration ---
// Get the log level from environment variables. Default to 'info' for production.
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const logger = {
  // Use for spammy, repetitive logs (like "checking for jobs")
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

// --- App & Middleware Configuration ---
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
// Whitelist of all allowed frontend URLs
const allowedOrigins = [
  'https://live-music-curator.vercel.app', // Production URL
  'https://live-music-curator-git-deployment-prep-scmor3s-projects.vercel.app', // Preview URL
  // --- Local Development ---
  'http://172.17.236.175:3001', // Your specific WSL frontend
  'http://localhost:3001'      // Standard localhost frontend
  // Other URLs can be added here as needed
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

// --- Helper Functions ---

/**
 * A simple helper function to pause execution.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uses the master refresh token to get a new, valid master access token.
 */
async function getMasterAccessToken() {
  const authHeader = 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'));
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', MASTER_REFRESH_TOKEN);

  try {
    const response = await axios.post('https://accounts.spotify.com/api/token', params, {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Authorization': authHeader
      }
    });

    // We don't need to handle new refresh tokens for the master account,
    // as we can just re-authenticate manually if it ever expires.
    return response.data.access_token;
  } catch (error) {
    logger.error('CRITICAL: Could not refresh master access token!', error.response ? error.response.data : error.message);
    throw new Error('Failed to get master access token.');
  }
}

/**
 * Creates a new playlist, finds/adds tracks, and saves all results to the DB.
 */
async function runCurationLogic(city, date, number_of_songs, accessToken, latitude, longitude, excludedGenres) {
  // Get the raw artist list by calling our scraper
  const rawArtistList = await scrapeBandsintown(date, latitude, longitude);
  // Check if we found any artists.
  if (!rawArtistList || rawArtistList.length === 0) {
    logger.info(`No artists found for "${city}" on ${date}.`);
    return { playlistId: null };
  }

  let nameSuffix = ''; // Start with an empty suffix
  if (excludedGenres && excludedGenres.length > 0) {
    // Create a "pretty" version of the genres, e.g., "Country, Jazz"
    const prettyGenres = excludedGenres.map(g => g.charAt(0).toUpperCase() + g.slice(1)).join(', ');
    nameSuffix = ` (Excl: ${prettyGenres})`;
  }

  // Create the new empty playlist on Spotify
  const playlistData = {
    name: `${city} ${date} live music${nameSuffix}`,
    description: `Artists performing in ${city} on ${date}, curated by Live Music Curator.`,
    public: true
  };
  const axiosConfig = {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  };
  const createPlaylistResponse = await axios.post(
    `https://api.spotify.com/v1/users/${MASTER_SPOTIFY_ID}/playlists`,
    playlistData,
    axiosConfig
  );
  const playlistId = createPlaylistResponse.data.id;
  logger.info(`Successfully created new playlist with ID: ${playlistId}`);

  // De-duplicate the list - normalize to lowercase to catch simple duplicates
  const lowercasedArtists = rawArtistList.map(name => name.toLowerCase().trim());
  const uniqueArtists = [...new Set(lowercasedArtists)];
  logger.info(`Found ${rawArtistList.length} total artists, de-duplicated to ${uniqueArtists.length} unique artists.`);

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

  // Loop through each artist and process
  for (let i = 0; i < uniqueArtists.length; i++) {
    const artistName = uniqueArtists[i];

    logger.info(`\n[${i + 1}/${uniqueArtists.length}] Processing artist: "${artistName}"`);
    try {
      const searchResponse = await axios.get(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );

      const potentialMatches = searchResponse.data.artists.items;
      if (potentialMatches.length === 0) {
        logger.info(`  -> No Spotify results for "${artistName}".`);
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
        logger.info(`  -> Found Exact Match: "${bestMatch.name}" (ID: ${spotifyArtistId}) & genres: ${bestMatch.genres.join(', ')}`);
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
        
        const SIMILARITY_THRESHOLD = 3;
        if (closestMatch && minDistance <= SIMILARITY_THRESHOLD) {
          // Found a close enough match
          bestMatch = closestMatch;
          spotifyArtistId = bestMatch.id;
          logger.info(`  -> Found Fuzzy Match: "${bestMatch.name}" (ID: ${spotifyArtistId}, Dist: ${minDistance}) & genres: ${bestMatch.genres.join(', ')}`);
        } else {
          // No good match found
          logger.warn(`No close match for "${artistName}". Skipping.`);
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
          logger.info(`  -> SKIPPING: Artist "${bestMatch.name}" has an excluded genre. (${bestMatch.genres.join(', ')})`);
          spotifyArtistId = null; // Set to null to skip track-adding
        }
    }

      // If we have a match, add tracks
      if (spotifyArtistId) {
        // Check if we've already added tracks for this exact Spotify ID
        if (processedArtistIds.has(spotifyArtistId)) {
          logger.info(`Already processed artist ID ${spotifyArtistId} (from a duplicate). Skipping track add.`);
          continue;
        }
        // If not, this is a new artist. Add them to our Set.
        processedArtistIds.add(spotifyArtistId);
        
        const topTracksResponse = await axios.get(
          `https://api.spotify.com/v1/artists/${spotifyArtistId}/top-tracks`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }
        );
        const tracksToAdd = topTracksResponse.data.tracks.slice(0, number_of_songs);
        const trackUris = tracksToAdd.map(track => track.uri);

        if (trackUris.length > 0) {
          await axios.post(
            `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
            { uris: trackUris },
            axiosConfig
          );
          // Use bestMatch.name for the log since artistName can be slightly different
          const logName = bestMatch ? bestMatch.name : artistName;
          logger.info(`  -> SUCCESS: Added ${trackUris.length} tracks for "${logName}".`);

          tracksAddedCount += trackUris.length;
        } else {
          logger.info(`  -> Found artist, but they have no top tracks. Skipping track add.`);
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
            // It's a rate-limit error, check for the 'retry-after' header
            const retryAfterSeconds = error.response.headers['retry-after'] || 5; 
            waitMs = Number(retryAfterSeconds) * 1000;
            waitReason = `429 rate limit`;
          }

          logger.warn(`Spotify ${waitReason}. (Retry ${currentRetries + 1}/${MAX_RETRIES}) Waiting ${waitMs / 1000}s for artist "${artistName}"...`);
          await sleep(waitMs);
          
          i--; // Rewind the loop to retry
          logger.info(`Retrying artist "${artistName}"...`);

        } else {
          // --- We're out of retries. Give up on this artist. ---
          logger.error(`Artist "${artistName}" failed after ${MAX_RETRIES} retries. Skipping.`);
        }
      } else {
        // It was a different, non-retryable error (like 404, 401)
        // Or a non-axios error. Log it and move on.
        logger.error(`Error processing artist "${artistName}":`, error.message);
      }
    }
  }
  logger.info(`\nCuration complete. Total tracks added to playlist: ${tracksAddedCount}`);
  // After the loop, check if we actually added any songs.
  if (tracksAddedCount === 0) {
    // We created an empty playlist. This is a "failure".
    logger.warn(`WORKER: No tracks added for playlist ${playlistId}. Deleting empty playlist...`);
    try {
      // We must "unfollow" (delete) the playlist from the master account.
      // This is a NEW Spotify API endpoint we are using.
      await axios.delete(
        `https://api.spotify.com/v1/playlists/${playlistId}/followers`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      logger.warn(`WORKER: Successfully deleted empty playlist ${playlistId}.`);
    } catch (deleteError) {
      logger.error(`WORKER: CRITICAL! Failed to delete empty playlist ${playlistId}.`, deleteError.message);
      // Don't stop, just let it return null.
    }
    
    // Return null, which our worker will see as a failure.
    return { playlistId: null };
  }
  return { playlistId };

}

/**
 * Finds one 'pending' job, runs it, and updates the DB.
 * Designed to be called repeatedly by a loop.
 */
async function processJobQueue() {
  let job; // declared outside the 'try' so we can use it in 'catch'
  logger.debug('WORKER (1/7): processJobQueue started.');

  try {
    // find any job that's been "building" for too long
    // (e.g., if the server crashed) and mark it as 'failed'.
    try {
      logger.debug('WORKER (2/7): Checking for zombie jobs...');
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
        logger.warn(`WORKER: Found and reset ${zombieJobs.length} zombie job(s).`);
      }
      logger.debug('WORKER (3/7): Zombie check complete.');
    } catch (reaperError) {
      // If this fails, the DB is probably down. Log it and stop.
      logger.error('WORKER: CRITICAL! Zombie reaper FAILED:', reaperError.message);
      return; // Stop the worker run
    }

    logger.debug('WORKER (4/7): Looking for a pending job...');
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
      logger.debug('WORKER (5/7): No pending jobs found.');
      logger.debug('WORKER: No pending jobs found.');
      return; // No jobs to do, so just stop here.
    }

    // Process the Job
    logger.info(`WORKER (6/7): Picked up job ${job.id}. Calling runCurationLogic on "${job.search_city}" on ${job.search_date}`);
    
    const accessToken = await getMasterAccessToken();

    // Run our curation logic with the job's data
    const { playlistId } = await runCurationLogic(
      job.search_city,
      job.search_date,
      job.number_of_songs,
      accessToken,
      job.latitude,
      job.longitude,
      job.excluded_genres
    );

    // Handle Success
    logger.info(`WORKER (7/7): Curation logic complete for job ${job.id}. PlaylistID: ${playlistId}`);
      if (playlistId) {
      await sql`
        UPDATE playlist_jobs 
        SET status = 'complete', playlist_id = ${playlistId}
        WHERE id = ${job.id};
      `;
    } else {
      logger.warn(`WORKER: Job ${job.id} found no artists. Marking as 'failed'.`);
      await sql`
        UPDATE playlist_jobs 
        SET status = 'failed', error_message = 'No artists were found for this city and date.'
        WHERE id = ${job.id};
      `;
    }

  } catch (error) {
    // Handle Failure
    logger.error(`WORKER: CRITICAL FAILURE for job ${job ? job.id : 'unknown'}. Full Error:`, error);
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
        logger.info(`WORKER: Successfully logged failure for job ${job.id} to DB.`);
      } catch (dbError) {
        logger.error(`WORKER: CRITICAL! FAILED TO LOG FAILURE for job ${job.id}. DB connection is down.`);
        logger.error('Original error:', error.message);
        logger.error('DB log error:', dbError.message);
      }
    }
  }
}

// Main API Routes

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
  const { city, date, lat, lon, genres } = req.query;
  const number_of_songs = 2;

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
  try {
    const existingJob = await sql`
      SELECT id, status, playlist_id 
      FROM playlist_jobs 
      WHERE 
        search_city = ${city} AND 
        search_date = ${date} AND
        number_of_songs = ${number_of_songs} AND
        excluded_genres IS NOT DISTINCT FROM ${genresArray}
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    if (existingJob.length > 0) {
      const job = existingJob[0];
      logger.info(`Cache HIT (Job): Found existing job ${job.id} with status: ${job.status}`);
      // Return the ID of the job we found.
      return res.json({ jobId: job.id });
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
        excluded_genres
      ) VALUES (
        ${city},
        ${date},
        ${latitude},
        ${longitude},
        ${number_of_songs},
        ${genresArray}
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
      SELECT status, playlist_id, error_message 
      FROM playlist_jobs 
      WHERE id = ${jobId};
    `;

    if (jobResult.length === 0) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const job = jobResult[0];

    // Send the whole job status back to the frontend.
    // The frontend will decide what to do with this.
    res.json({
      status: job.status,
      playlistId: job.playlist_id,
      error: job.error_message
    });

  } catch (error) {
    logger.error('Error in /api/playlists/status:', error);
    return res.status(500).json({ error: 'Error fetching job status.' });
  }
});

/**
 * The Worker Loop
 * Starts the queue processing when the server boots.
 */
function startWorker() {
  logger.info('Worker loop starting... Will check for jobs every 10 seconds.');
  
  // This lock prevents our worker from "overlapping"
  // if a single job takes longer than 10s to run.
  let isWorkerRunning = false;

  const runWorker = async () => {
    if (isWorkerRunning) {
      logger.debug('Worker is already running. Skipping this interval.');
      return;
    }
    
    isWorkerRunning = true;
    logger.debug('Worker checking for jobs...');
    try {
      await processJobQueue();
    } catch (err) {
      logger.error('Unhandled critical error in worker loop:', err);
    } finally {
      isWorkerRunning = false;
    }
  };

  setInterval(runWorker, 10000);
}

startWorker();

// Start the Server
app.listen(port, '0.0.0.0', () => {
  logger.info(`Server listening on port ${port}. Access at http://localhost:${port}`);
});