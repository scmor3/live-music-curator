const express = require('express')
const querystring = require('querystring');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const postgres = require('postgres');
const jwt = require('jsonwebtoken');
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


app.post('/api/playlists', (req, res) => {
  console.log('Data received in request body:', req.body);
  const artistList = req.body.artists;
  res.json({ 
    message: 'Successfully received artist list!',
    receivedData: artistList 
  });
});



// Start the server
app.listen(port, ()  => {
  console.log(`Example app listening at http://localhost:${port}`)
})
