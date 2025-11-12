console.log("--- RUNNING LATEST INDEX.JS (DATABASE_URL version) ---");

// --- Imports ---
const express = require('express');
const axios = require('axios');
const postgres = require('postgres');
const levenshtein = require('fast-levenshtein');
const cors = require('cors');
const { scrapeBandsintown } = require('./utils/bandsintownScraper');
require('dotenv').config();

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
    console.log('CORS CHECK: Received origin:', origin);

    // Check if the incoming request's 'origin' is in our whitelist
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      // If it is (or a server-to-server request), allow it.
      callback(null, true);
    } else {
      // If it's not in the whitelist, block it.
      console.error('CORS BLOCKED:', origin); // Log the blocked origin
      
      // Send 'false' to block the request, instead of an Error to avoid crashing the server.
      callback(null, false); 
    }
  }
};
app.use(cors(corsOptions));

let sql;

// Check which environment variables are available
if (process.env.DATABASE_URL) {
  // --- PRODUCTION ---
  // Render provides the DATABASE_URL. Use it.
  console.log('Connecting to database using DATABASE_URL...');
  sql = postgres(process.env.DATABASE_URL);
} else {
  // --- LOCAL ---
  // We're local. Use the .env file's separate variables.
  console.log('Connecting to database using local .env variables...');
  sql = postgres({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    onnotice: () => {}, // quiet postgres console logs
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
    console.error('CRITICAL: Could not refresh master access token!', error.response ? error.response.data : error.message);
    throw new Error('Failed to get master access token.');
  }
}

/**
 * Creates a new playlist, finds/adds tracks, and saves all results to the DB.
 */
async function runCurationLogic(city, date, number_of_songs, accessToken, latitude, longitude) {
  // Get the raw artist list by calling our scraper
  const rawArtistList = await scrapeBandsintown(date, latitude, longitude);
  // Check if we found any artists.
  if (!rawArtistList || rawArtistList.length === 0) {
    console.log(`No artists found for "${city}" on ${date}.`);
    return { playlistId: null };
  }
  // Create the new empty playlist on Spotify
  const playlistData = {
    name: `${city} ${date} live music`,
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
  console.log(`Successfully created new playlist with ID: ${playlistId}`);

  // De-duplicate the list - normalize to lowercase to catch simple duplicates
  const lowercasedArtists = rawArtistList.map(name => name.toLowerCase().trim());
  const uniqueArtists = [...new Set(lowercasedArtists)];
  console.log(`Found ${rawArtistList.length} total artists, de-duplicated to ${uniqueArtists.length} unique artists.`);

  // Initialize array to hold artist results
  const processedArtistIds = new Set(); // deal with for duplicate Spotify IDs
  const retryCounts = {}; // Object to track retries per artist

  // Loop through each artist and process
  for (let i = 0; i < uniqueArtists.length; i++) {
    const artistName = uniqueArtists[i];

    console.log(`\n[${i + 1}/${uniqueArtists.length}] Processing artist: "${artistName}"`);
    try {
      const searchResponse = await axios.get(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );

      const potentialMatches = searchResponse.data.artists.items;
      if (potentialMatches.length === 0) {
        console.log(`  -> No Spotify results for "${artistName}".`);
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
        console.log(`  -> Found Exact Match: "${bestMatch.name}" (ID: ${spotifyArtistId})`);
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
          console.log(`  -> Found Fuzzy Match: "${bestMatch.name}" (ID: ${spotifyArtistId}, Dist: ${minDistance})`);
        } else {
          // No good match found
          console.log(`No close match for "${artistName}". Skipping.`);
        }
      }

      // If we have a match, add tracks
      if (spotifyArtistId) {
        // Check if we've already added tracks for this exact Spotify ID
        if (processedArtistIds.has(spotifyArtistId)) {
          console.log(`Already processed artist ID ${spotifyArtistId} (from a duplicate). Skipping track add.`);
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
          console.log(`  -> SUCCESS: Added ${trackUris.length} tracks for "${logName}".`);
        } else {
          console.log(`  -> Found artist, but they have no top tracks. Skipping track add.`);
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
          
          console.warn(`Spotify ${waitReason}. (Retry ${currentRetries + 1}/${MAX_RETRIES}) Waiting ${waitMs / 1000}s for artist "${artistName}"...`);
          await sleep(waitMs);
          
          i--; // Rewind the loop to retry
          console.log(`Retrying artist "${artistName}"...`);

        } else {
          // --- We're out of retries. Give up on this artist. ---
          console.error(`Artist "${artistName}" failed after ${MAX_RETRIES} retries. Skipping.`);
        }
      } else {
        // It was a different, non-retryable error (like 404, 401)
        // Or a non-axios error. Log it and move on.
        console.error(`Error processing artist "${artistName}":`, error.message);
      }
    }
  }
  return { playlistId };

}

/**
 * Finds one 'pending' job, runs it, and updates the DB.
 * Designed to be called repeatedly by a loop.
 */
async function processJobQueue() {
  let job; // declared outside the 'try' so we can use it in 'catch'

  try {
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
      console.log('WORKER: No pending jobs found.');
      return; // No jobs to do, so just stop here.
    }

    // Process the Job
    console.log(`WORKER: Picked up job ${job.id} for "${job.search_city}" on ${job.search_date}`);
    
    const accessToken = await getMasterAccessToken();

    // Run our curation logic with the job's data
    const { playlistId } = await runCurationLogic(
      job.search_city,
      job.search_date,
      job.number_of_songs,
      accessToken,
      job.latitude,
      job.longitude
    );

    // Handle Success
    console.log(`WORKER: Job ${job.id} complete. Playlist ID: ${playlistId}`);
    await sql`
      UPDATE playlist_jobs 
      SET 
        status = 'complete', 
        playlist_id = ${playlistId}
      WHERE id = ${job.id};
    `;
  } catch (error) {
    // Handle Failure
    console.error(`WORKER: Job ${job ? job.id : 'unknown'} FAILED:`, error.message);
    if (job) {
      // If a job fails, we mark it as 'failed' and log the error.
      await sql`
        UPDATE playlist_jobs 
        SET 
          status = 'failed', 
          error_message = ${error.message}
        WHERE id = ${job.id};
      `;
    }
  }
}

// Main API Routes

/**
 * Health check route.
 */
app.get('/', (req, res) => {
  res.json({ message: 'Server is up and running!' });
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
      SELECT name, latitude, longitude, similarity(name, ${q}) as sml
      FROM cities
      WHERE similarity(name, ${q}) > 0.1 -- Set a threshold (0.1 is pretty low/fuzzy)
      ORDER BY sml DESC -- Order by the best match first
      LIMIT 10; -- Only return the top 10 matches
    `;
    
    // Format and return the results
    const suggestions = results.map(r => ({
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude
    }));

    res.json(suggestions);

  } catch (error) {
  // --- THIS IS THE NEW, BETTER LOG ---
    console.error('Error in /api/search-cities: FULL ERROR OBJECT:');
    console.error(error);
    res.status(500).json({ error: 'Error searching for cities.' });
  }
});

/**
 * Main curation route.
 * Validates input and creates a new 'pending' job in the DB.
 */
app.get('/api/playlists', async (req, res) => {
  // Validate Input
  const { city, date, lat, lon } = req.query;
  const number_of_songs = 2;

  if (!city || !date || !lat || !lon) {
    return res.status(400).json({ error: 'Missing required query parameters: city, date, lat, and lon' });
  }

  // Convert lat/lon to numbers for safety
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

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
        number_of_songs = ${number_of_songs}
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    if (existingJob.length > 0) {
      const job = existingJob[0];
      console.log(`Cache HIT (Job): Found existing job ${job.id} with status: ${job.status}`);
      // Return the ID of the job we found.
      return res.json({ jobId: job.id });
    }

    // Create a New Job
    console.log(`Cache MISS (Job): No job found for ${city} on ${date}. Creating new job...`);
    
    const newJob = await sql`
      INSERT INTO playlist_jobs (
        search_city,
        search_date,
        latitude,
        longitude,
        number_of_songs
      ) VALUES (
        ${city},
        ${date},
        ${latitude},
        ${longitude},
        ${number_of_songs}
      )
      RETURNING id;
    `;

    const jobId = newJob[0].id;
    console.log(`Successfully created new job with ID: ${jobId}`);

    // Send the job ID back to the user immediately
    return res.status(202).json({ jobId: jobId }); // 202 means "Accepted"

  } catch (error) {
    console.error('Error in /api/playlists (job creation):', error);
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
    console.error('Error in /api/playlists/status:', error);
    return res.status(500).json({ error: 'Error fetching job status.' });
  }
});

/**
 * Main curation route.
 * Checks for a cached playlist, or builds one on-demand.
 */
// app.get('/api/playlists', async (req, res) => {
//   // Validate input
//   const { city, date, lat, lon } = req.query;
//   const number_of_songs = 2;

//   // Validate Input (Basic)
//   if (!city || !date || !lat || !lon) {
//     return res.status(400).json({ error: 'Missing required query parameters: city, date, lat, and lon' });
//   }

//   // Convert lat/lon to numbers for safety
//   const latitude = parseFloat(lat);
//   const longitude = parseFloat(lon);

//   try {
//     // Check "Cache" (Our Database)
//     const cacheResult = await sql`
//       SELECT playlist_id 
//       FROM curation_requests 
//       WHERE 
//         search_city = ${city} AND 
//         search_date = ${date} AND
//         number_of_songs = ${number_of_songs};
//     `;

//     if (cacheResult.length > 0) {
//       // Cache HIT: Return the found playlist
//       const playlistId = cacheResult[0].playlist_id; // This could be NULL if no artists were found previously
//       if (playlistId === null) {
//         console.log(`Cache HIT (Negative): No artists found for ${city} on ${date}.`);
//         return res.status(404).json({ error: 'No artists found for this city and date.' });
//       } else {
//         console.log(`Cache HIT (Positive): Found pre-built playlist for ${city} on ${date}.`);
//         return res.json({ 
//           playlistId: playlistId,
//           source: 'cache' 
//         });
//       }
//     }

//     // Cache MISS: Build the playlist
//     console.log(`Cache MISS: No playlist found for ${city} on ${date}. Building...`);
    
//     // First, get a master access token
//     const accessToken = await getMasterAccessToken();

//     // Now, run the main curation logic
//     const { playlistId, curatedArtistsData } = await runCurationLogic(
//       city, 
//       date, 
//       number_of_songs, 
//       accessToken, 
//       latitude, 
//       longitude
//     );

//     // Save the results to database *after* the logic is done.
//     const curationRequestResult = await sql`
//       INSERT INTO curation_requests (
//         search_city,
//         search_date,
//         number_of_songs,
//         playlist_id -- This will be 'null' if no artists were found
//       )
//       VALUES (
//         ${city}, 
//         ${date}, 
//         ${number_of_songs}, 
//         ${playlistId} 
//       )
//       RETURNING id;
//     `;
//     const curationRequestId = curationRequestResult[0].id;

//     // Save the detailed artist results
//     if (curatedArtistsData.length > 0) {
//       // We must add the new curationRequestId to all our objects
//       const artistsToInsert = curatedArtistsData.map(artist => ({
//         ...artist,
//         curation_request_id: curationRequestId 
//       }));

//       console.log(`Saving ${artistsToInsert.length} curated artist results...`);
//       await sql`
//         INSERT INTO curated_artists ${sql(artistsToInsert, 
//           'curation_request_id', 
//           'artist_name_raw', 
//           'spotify_artist_id', 
//           'confidence_score'
//         )}
//       `;
//       console.log('Successfully saved curated artist data.');
//     }

//     // Send the final response to the client
//     if (playlistId === null) {
//       // We finished, but found no artists. Send the 404.
//       return res.status(404).json({ error: 'No artists found for this city and date.' });
//     } else {
//       // We finished and created a playlist!
//       return res.json({ 
//         playlistId: playlistId,
//         source: 'new' 
//       });
//     }

//   } catch (error) {
//     console.error('Error in /api/playlists logic:', error.message);
//     return res.status(500).json({ error: 'Internal server error.' });
//   } finally {
//     isBuilding = false;
//     console.log("Build finished. Releasing lock.");
//   }
// });

/**
 * The Worker Loop
 * Starts the queue processing when the server boots.
 */
function startWorker() {
  console.log('Worker loop starting... Will check for jobs every 10 seconds.');
  
  // This lock prevents our worker from "overlapping"
  // if a single job takes longer than 10s to run.
  let isWorkerRunning = false;

  const runWorker = async () => {
    if (isWorkerRunning) {
      console.log('Worker is already running. Skipping this interval.');
      return;
    }
    
    isWorkerRunning = true;
    console.log('Worker checking for jobs...');
    try {
      await processJobQueue();
    } catch (err) {
      console.error('Unhandled critical error in worker loop:', err);
    } finally {
      isWorkerRunning = false;
    }
  };

  setInterval(runWorker, 10000);
}

startWorker();

// Start the Server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}. Access at http://localhost:${port}`);
});