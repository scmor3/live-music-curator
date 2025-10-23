const express = require('express')
const querystring = require('querystring');
require('dotenv').config();

const generateRandomString = (length) => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

// 3. App & Middleware Configuration
const app = express()
const port = 3000
// Middleware to parse JSON bodies
app.use(express.json());

// Route definitions
app.get('/', (req, res) => {
  res.json({ message: 'Server is up and running!' })
})

app.get('/login', function(req, res) {

  const state = generateRandomString(16);
  const scope = 'user-read-private user-read-email playlist-modify-private playlist-modify-public';

  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
});

app.get('/api/callback', function(req, res) {

  const code = req.query.code || null;
  const state = req.query.state || null;

  if (state === null) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    const authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + (new Buffer.from(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };
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

const client_id = process.env.SPOTIFY_CLIENT_ID;
const redirect_uri = 'http://127.0.0.1:3000/api/callback';


// Start the server
app.listen(port, ()  => {
  console.log(`Example app listening at http://localhost:${port}`)
})
