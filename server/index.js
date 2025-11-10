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
const port = 3000;
app.use(express.json());
// Whitelist of all allowed frontend URLs
const allowedOrigins = [
  'https://live-music-curator.vercel.app', // Production URL
  'live-music-curator-git-deployment-prep-scmor3s-projects.vercel.app' // Preview URL
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

// Create a single, shared database connection pool
const sql = postgres({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  // quiet postgres console logs
  onnotice: () => {}, 
});

// --- Constants ---
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const MASTER_REFRESH_TOKEN = process.env.MASTER_REFRESH_TOKEN;
const MASTER_SPOTIFY_ID = process.env.MASTER_SPOTIFY_ID;

// --- Helper Functions ---

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
    return { playlistId: null, curatedArtistsData: [] };
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
  const curatedArtistsData = [];
  const processedArtistIds = new Set(); // deal with for duplicate Spotify IDs

  // Loop through each artist and process
  for (const artistName of uniqueArtists) {
    try {
      const searchResponse = await axios.get(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );

      const potentialMatches = searchResponse.data.artists.items;
      if (potentialMatches.length === 0) {
        console.log(`No Spotify results for "${artistName}".`);
        curatedArtistsData.push({
          // We will add curation_request_id *later*, after the loop
          artist_name_raw: artistName,
          spotify_artist_id: null,
          confidence_score: 0
        });
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
      let confidenceScore = 0;

      if (bestMatch) {
        // Found Exact Match
        spotifyArtistId = bestMatch.id;
        confidenceScore = 100.00;

        curatedArtistsData.push({
          artist_name_raw: artistName,
          spotify_artist_id: spotifyArtistId,
          confidence_score: confidenceScore
        });

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
          confidenceScore = 100.00 - (minDistance * 10);
          curatedArtistsData.push({
            artist_name_raw: artistName,
            spotify_artist_id: spotifyArtistId,
            confidence_score: confidenceScore
          });

        } else {
          // No good match found
          console.log(`No close match for "${artistName}". Skipping.`);
          curatedArtistsData.push({
            artist_name_raw: artistName,
            spotify_artist_id: null,
            confidence_score: 0
          });
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
          console.log(`Added ${trackUris.length} tracks for "${artistName}"`);
        }
      }
    } catch (error) {
      console.error(`Error processing artist "${artistName}":`, error.message);
      curatedArtistsData.push({
        artist_name_raw: artistName,
        spotify_artist_id: null,
        confidence_score: 0
      });
      continue;
    }
  }
  return { playlistId, curatedArtistsData };

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
 * Checks for a cached playlist, or builds one on-demand.
 */
app.get('/api/playlists', async (req, res) => {
  // We now expect the client to send us the exact lat/lon
  const { city, date, lat, lon } = req.query;
  const number_of_songs = 2;

  // Validate Input (Basic)
  if (!city || !date || !lat || !lon) {
    return res.status(400).json({ error: 'Missing required query parameters: city, date, lat, and lon' });
  }

  // Convert lat/lon to numbers for safety
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  try {
    // Check "Cache" (Our Database)
    const cacheResult = await sql`
      SELECT playlist_id 
      FROM curation_requests 
      WHERE 
        search_city = ${city} AND 
        search_date = ${date} AND
        number_of_songs = ${number_of_songs};
    `;

    if (cacheResult.length > 0) {
      // Cache HIT: Return the found playlist
      const playlistId = cacheResult[0].playlist_id; // This could be NULL if no artists were found previously
      if (playlistId === null) {
        console.log(`Cache HIT (Negative): No artists found for ${city} on ${date}.`);
        return res.status(404).json({ error: 'No artists found for this city and date.' });
      } else {
        console.log(`Cache HIT (Positive): Found pre-built playlist for ${city} on ${date}.`);
        return res.json({ 
          playlistId: playlistId,
          source: 'cache' 
        });
      }
    }

    // Cache MISS: Build the playlist
    console.log(`Cache MISS: No playlist found for ${city} on ${date}. Building...`);
    
    // First, get a master access token
    const accessToken = await getMasterAccessToken();

    // Now, run the main curation logic
    const { playlistId, curatedArtistsData } = await runCurationLogic(
      city, 
      date, 
      number_of_songs, 
      accessToken, 
      latitude, 
      longitude
    );

    // Save the results to database *after* the logic is done.
    const curationRequestResult = await sql`
      INSERT INTO curation_requests (
        search_city,
        search_date,
        number_of_songs,
        playlist_id -- This will be 'null' if no artists were found
      )
      VALUES (
        ${city}, 
        ${date}, 
        ${number_of_songs}, 
        ${playlistId} 
      )
      RETURNING id;
    `;
    const curationRequestId = curationRequestResult[0].id;

    // Save the detailed artist results
    if (curatedArtistsData.length > 0) {
      // We must add the new curationRequestId to all our objects
      const artistsToInsert = curatedArtistsData.map(artist => ({
        ...artist,
        curation_request_id: curationRequestId 
      }));

      console.log(`Saving ${artistsToInsert.length} curated artist results...`);
      await sql`
        INSERT INTO curated_artists ${sql(artistsToInsert, 
          'curation_request_id', 
          'artist_name_raw', 
          'spotify_artist_id', 
          'confidence_score'
        )}
      `;
      console.log('Successfully saved curated artist data.');
    }

    // Send the final response to the client
    if (playlistId === null) {
      // We finished, but found no artists. Send the 404.
      return res.status(404).json({ error: 'No artists found for this city and date.' });
    } else {
      // We finished and created a playlist!
      return res.json({ 
        playlistId: playlistId,
        source: 'new' 
      });
    }

  } catch (error) {
    // This is the main safety net
    console.error('Error in /api/playlists logic:', error.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});


// Start the Server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}. Access at http://localhost:${port}`);
});