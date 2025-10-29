const express = require('express')
const querystring = require('querystring');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const postgres = require('postgres');
const jwt = require('jsonwebtoken');
const levenshtein = require('fast-levenshtein');
require('dotenv').config();

// 3. App & Middleware Configuration
const app = express()
const port = 3000
app.use(express.json());
app.use(cookieParser());
const sql = postgres({
  host      : process.env.DB_HOST,
  port      : Number(process.env.DB_PORT),
  database  : process.env.DB_NAME,
  user      : process.env.DB_USER,
  password  : process.env.DB_PASS
});

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'http://127.0.0.1:3000/api/callback';

const stateKey = 'spotify_auth_state'; // The name of the cookie we'll use to store the state

const generateRandomString = (length) => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

// Route definitions
app.get('/', (req, res) => {
  res.json({ message: 'Server is up and running!' })
})

app.get('/login', function(req, res) {

  const state = generateRandomString(16);
  res.cookie(stateKey, state, { httpOnly: true });
  const scope = 'user-read-private user-read-email playlist-modify-private playlist-modify-public';

  const authUrl = 'https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: scope,
      redirect_uri: REDIRECT_URI,
      state: state
    });

  res.redirect(authUrl);
});

/**
 * The callback route that Spotify redirects to.
 * This route will exchange the 'code' for an 'access_token'.
 */
app.get('/api/callback', async (req, res) => {

  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies[stateKey] : null;


  if (state === null || state !== storedState) {
    res.clearCookie(stateKey); // Clear the bad cookie
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    res.clearCookie(stateKey);
    const authHeader = 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'));
    const params = new URLSearchParams();
    params.append('code', code);
    params.append('redirect_uri', REDIRECT_URI);
    params.append('grant_type', 'authorization_code');
    
    try {
      const response = await axios.post('https://accounts.spotify.com/api/token', params, {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'Authorization': authHeader
        }
      });

      const accessToken = response.data.access_token;
      const refreshToken = response.data.refresh_token;

      //Use the accessToken to call Spotify's /me endpoint
      const userProfileResponse = await axios.get('https://api.spotify.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      //Get the user's info from the response
      const spotifyId = userProfileResponse.data.id;
      const displayName = userProfileResponse.data.display_name;
      const email = userProfileResponse.data.email;
      const profilePicture = userProfileResponse.data.images[0]?.url; // Get the first profile image, if it exists
      // Find or create that user in our database.
      const userResult = await sql`
        INSERT INTO users (
          spotify_id, 
          display_name, 
          email, 
          profile_picture, 
          refresh_token
        )
        VALUES (
          ${spotifyId}, 
          ${displayName}, 
          ${email}, 
          ${profilePicture}, 
          ${refreshToken}
        )
        ON CONFLICT (spotify_id) 
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          profile_picture = EXCLUDED.profile_picture,
          refresh_token = EXCLUDED.refresh_token
        RETURNING id;
      `;

      // Get the user's unique ID from our database
      const userId = userResult[0].id;

      // Create a secure session token (JWT)
      const payload = { userId: userId };
      const secret = process.env.JWT_SECRET;
      const options = { expiresIn: '1h' }; // The token will expire in 1 hour

      const token = jwt.sign(payload, secret, options);

      // Send the token to the user as a secure, HttpOnly cookie
      res.cookie('token', token, {
        httpOnly: true, // Makes it invisible to client-side JavaScript
        maxAge: 60 * 60 * 1000, // 1 hour in milliseconds (must match the token's 'expiresIn')
        // **We'll add 'secure: true' later for production (HTTPS)**
      });
      console.log(`User ${userId} logged in successfully.`);

      // Redirect the user to the frontend application
      res.redirect('http://localhost:3001/');

    } catch (error) {
      console.error('Error exchanging tokens:', error.response ? error.response.data : error.message);
      // If the token exchange fails, send an error.
      res.redirect('/#' +
        querystring.stringify({
          error: 'invalid_token'
        }));
    }
  }
});


app.post('/api/playlists', async (req, res) => {
  // --- 1. AUTHENTICATION & VERIFICATION ---
  const token = req.cookies.token; // check for the JWT token in cookies
  if (!token) {
    return res.status(401).json({ error: 'No token provided. Access denied.' });
  }
  let userId; // declare before try statement so we can use it when we leave the block
  try {
    // Will throw an error if the token is expired or the signature is bad
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // If we get here, the token is valid
    userId = payload.userId;
  } catch (error) {
    // If verification fails, send a 401 Unauthorized error
    return res.status(401).json({ error: 'Access denied. Invalid token.' });
  }
  console.log(`User ${userId} is authenticated and is creating a playlist.`);
  // --- 2. MAIN BUSINESS LOGIC (with a safety net) ---
  try {
    // get user's refresh token from database.
    const userResult = await sql`
      SELECT refresh_token, spotify_id FROM users WHERE id = ${userId};
    `;
    if (userResult.length === 0) {
      return res.status(404).json({ error: 'User not found in database.' });
    }
    const refreshToken = userResult[0].refresh_token;
    const spotifyId = userResult[0].spotify_id;
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

    console.log('Data received in request body:', req.body);
    const { city, date, artists } = req.body;
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
    // Loop through artistList.

    // Search for each artist.

    // Add tracks to the playlist.

    // Save the results to our database.
    const playlistId = createPlaylistResponse.data.id;
    console.log(`Successfully created new playlist with ID: ${playlistId}`);
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
          
          // TODO: Get top tracks for this spotifyArtistId
          // TODO: Add tracks to playlistId
          // TODO: Record this successful match (artistName, spotifyArtistId, confidenceScore) for saving later
          
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
            
            // TODO: Get top tracks for this spotifyArtistId
            // TODO: Add tracks to playlistId
            // TODO: Record this successful match (artistName, spotifyArtistId, confidenceScore) for saving later

          } else {
            console.log(`No sufficiently close match found for "${artistName}". Closest was "${closestMatch?.name}" with distance ${minDistance}. Skipping.`);
            // TODO: Record this failed match (artistName, null, 0) for saving later
          }
      // --- END: No exact match logic ---
          // TODO: Record this failed match (artistName, null, 0) for saving later
        }

        // ... continue to the next artist ...
      } catch (error) {
        // Catch errors *specific* to this artist's search/processing
        console.error(`Error processing artist "${artistName}":`, error.message);
        // Continue to the next artist even if one fails
        continue; 
      }
    }
    res.json({
      message: 'Successfully created playlist!',
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
app.listen(port, ()  => {
  console.log(`Example app listening at http://localhost:${port}`)
})
