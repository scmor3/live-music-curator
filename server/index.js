const express = require('express')
const app = express()
const port = 3000

// Middleware to parse JSON bodies
app.use(express.json());

// Route definitions
app.get('/', (req, res) => {
  res.json({ message: 'Server is up and running!' })
})

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
