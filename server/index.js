const express = require('express')
const querystring = require('querystring');
const axios = require('axios');
const postgres = require('postgres');
const levenshtein = require('fast-levenshtein');
require('dotenv').config();

// 3. App & Middleware Configuration
const app = express()
const port = 3000
app.use(express.json());
const sql = postgres({
  host      : process.env.DB_HOST,
  port      : Number(process.env.DB_PORT),
  database  : process.env.DB_NAME,
  user      : process.env.DB_USER,
  password  : process.env.DB_PASS
});

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Route definitions
app.get('/', (req, res) => {
  res.json({ message: 'Server is up and running!' })
})

app.get('/api/playlists', async (req, res) => {
  try {
    const refreshToken = proccess.env.MASTER_SPOTIFY_REFRESH_TOKEN;
    const spotifyId = process.env.MASTER_SPOTIFY_ID;
    // Use the refresh token to get a new access token from Spotify.
    let accessToken;
    try {
      const authHeader = 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'));
      
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', refreshToken);

      const response = await axios.post('https://accounts.spotify.com/api/token', params, {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'Authorization': authHeader
        }
      });

      accessToken = response.data.access_token;
      const newRefreshToken = response.data.refresh_token;
      if (newRefreshToken) {
        console.log('New refresh token received. Updating database...');
        await sql`
        UPDATE users SET refresh_token = ${newRefreshToken} WHERE id = ${userId};
      `;
      }

    } catch (error) {
      // This is a critical error. The user's refresh_token might be bad.
      console.error('Error refreshing token:', error.response ? error.response.data : error.message);
      // We need to tell the user they are unauthorized
      return res.status(401).json({ error: 'Failed to refresh token. Please log in again.' });
    }
    console.log('Successfully refreshed access token.');

    const { city, date } = req.query;
    const number_of_songs = 2;
    const playlistData = {
    // Create an empty playlist on Spotify.
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
      `https://api.spotify.com/v1/users/${spotifyId}/playlists`,
      playlistData,
      axiosConfig
    );
    // Save the results to our database.
    const playlistId = createPlaylistResponse.data.id;
    console.log(`Successfully created new playlist with ID: ${playlistId}`);
    const curationRequestResult = await sql`
        INSERT INTO curation_requests (
          user_id,
          search_city,
          search_date,
          number_of_songs,
          playlist_id
        )
        VALUES (
          ${userId}, 
          ${city}, 
          ${date}, 
          ${number_of_songs}, 
          ${playlistId}
        )
        RETURNING id;
      `;
    const curationRequestId = curationRequestResult[0].id;

    const curatedArtistsData = [];
    // loop through artist
    for (const artistName of artists) {
      try {
        const searchResponse = await axios.get(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }
        );
        const potentialMatches = searchResponse.data.artists.items;
        if (potentialMatches.length === 0) {
          console.log(`No Spotify results found for "${artistName}". Skipping.`);
          continue;
        }
        // 3. Find the best match
        let bestMatch = null;

        for (const match of potentialMatches) {
          if (match.name.toLowerCase() === artistName.toLowerCase()) {
            bestMatch = match;
            console.log(`Exact match found for "${artistName}": ${bestMatch.name} (ID: ${bestMatch.id})`);
            break;
          }
        }
        // 4. Check if we found an exact match
        if (bestMatch) {
          const spotifyArtistId = bestMatch.id;
          const confidenceScore = 100.00;

          // Get top tracks for this spotifyArtistId
          const topTracksResponse = await axios.get(
            `https://api.spotify.com/v1/artists/${spotifyArtistId}/top-tracks`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            }
          );
          const tracksToAdd = topTracksResponse.data.tracks.slice(0, number_of_songs);
          // get track URIs
          const trackUris = tracksToAdd.map(track => track.uri);
          // Add tracks to playlist
          await axios.post(
            `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
            { uris: trackUris },
            {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            }
          );
          console.log(`Added top tracks for "${artistName}" to playlist.`);
          // Record this successful match (artistName, spotifyArtistId, confidenceScore) for saving later
          curatedArtistsData.push({ 
            curation_request_id: curationRequestId, 
            artist_name_raw: artistName, 
            spotify_artist_id: spotifyArtistId,
            confidence_score: confidenceScore
          });
        } else {
          console.log(`No exact match for "${artistName}". Need to check similarity.`);
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
            // We found a reasonably close match!
            bestMatch = closestMatch; // Assign it to bestMatch
            const confidenceScore = 100.00 - (minDistance * 10); // Simple score: less distance = higher score
            
            console.log(`Closest match found for "${artistName}": ${bestMatch.name} (ID: ${bestMatch.id}), Distance: ${minDistance}, Score: ${confidenceScore}`);

            const spotifyArtistId = bestMatch.id;
            curatedArtistsData.push({ 
              curation_request_id: curationRequestId, 
              artist_name_raw: artistName, 
              spotify_artist_id: spotifyArtistId,
              confidence_score: confidenceScore
            });
            // Get top tracks for this spotifyArtistId
            const topTracksResponse = await axios.get(
              `https://api.spotify.com/v1/artists/${spotifyArtistId}/top-tracks`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              }
            );
            const tracksToAdd = topTracksResponse.data.tracks.slice(0, number_of_songs);
            // get track URIs
            const trackUris = tracksToAdd.map(track => track.uri);
            // Add tracks to playlist
            await axios.post(
              `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
              { uris: trackUris },
              {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              }
            );
            console.log(`Added top tracks for "${artistName}" to playlist.`);
          } else {
            console.log(`No sufficiently close match found for "${artistName}". Closest was "${closestMatch?.name}" with distance ${minDistance}. Skipping.`);
            curatedArtistsData.push({ 
              curation_request_id: curationRequestId, 
              artist_name_raw: artistName, 
              spotify_artist_id: null,
              confidence_score: 0
            });          
          }
      // --- END: No exact match logic ---
        }

        // ... continue to the next artist ...
      } catch (error) {
        // Catch errors *specific* to this artist's search/processing
        console.error(`Error processing artist "${artistName}":`, error.message);
        // Continue to the next artist even if one fails
        continue; 
      }
    }
    // Check if we actually have any data to insert
    if (curatedArtistsData.length > 0) {
      console.log(`Saving ${curatedArtistsData.length} curated artist results to the database...`);
      
      await sql`
        INSERT INTO curated_artists ${sql(curatedArtistsData, 
          'curation_request_id', 
          'artist_name_raw', 
          'spotify_artist_id', 
          'confidence_score'
        )}
      `;
      console.log('Successfully saved curated artist data.');
    } else {
      console.log('No artist data to save.');
    }
    // Send the final response to the user
    res.json({
      message: 'Playlist created and curation results saved!',
      playlistId: playlistId 
    });
  } catch (error) {
    // This is the "main" safety net.
    // It catches errors from the database SELECT, or the playlist POST
    console.error('Error in main playlist creation logic:', error.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});




// Start the server
app.listen(port, '0.0.0.0', ()  => {
  console.log(`Server listening on port ${port}. Access at http://localhost:${port}`)
})
