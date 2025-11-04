"use client";

// Import 'useState' from React
import { useState } from 'react';

export default function HomePage() {
  // 1. Define our State
  const [date, setDate] = useState('');
  
  // We need new state variables to track the API call
  const [playlistId, setPlaylistId] = useState(''); // To store the final result
  const [isLoading, setIsLoading] = useState(false); // To show a loading spinner
  const [error, setError] = useState(''); // To show any error messages

  /**
   * This function runs when the user clicks "Find Music"
   */
  const handleFindMusic = async () => {
    console.log('Button clicked!');
    console.log('User selected date:', date);
    
    //2. Start the API Call
    setIsLoading(true); // Show loading spinner
    setError(''); // Clear any old errors
    setPlaylistId(''); // Clear any old results
    
    const city = 'Austin'; // Hardcoded for V1

    try {
      // 3. Build the URL for our backend API
      const queryParams = new URLSearchParams({
        city: city,
        date: date
      });
      
      // We're calling our own server, which is on port 3000
      const response = await fetch(`http://172.17.236.175:3000/api/playlists?${queryParams}`);

      if (!response.ok) {
        // Handle server errors (like 500, 404)
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // 4. Get the JSON data from the response
      const data = await response.json();
      
      if (data.playlistId) {
        setPlaylistId(data.playlistId); // Success! Save the result
      } else {
        // Handle cases where the server responded OK but had no ID
        throw new Error('No playlist ID found in response.');
      }

    } catch (err) {
      // 5. Handle any errors during the fetch
      console.error('Error fetching playlist:', err);
      // Check if the error is a TypeError, which could be a network error
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        setError('Network error. Is the server running and firewall configured?');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred. Please try again.');
      }
    } finally {
      // 6. This runs no matter what (success or error)
      setIsLoading(false); // Hide loading spinner
    }
  };

  return (
    <main>
      <h1>My Live Music Curator</h1>
      <p>This is the new homepage!</p>
      
      <div>
        <label htmlFor="date-picker">
          Select a date:
        </label>
        <input 
          type="date" 
          id="date-picker"
          value={date} 
          onChange={(e) => setDate(e.target.value)} 
          disabled={isLoading} // Disable input while loading
        />
      </div>

      <button onClick={handleFindMusic} disabled={isLoading}>
        {/* 7. Show "Loading..." text when loading */}
        {isLoading ? 'Finding Music...' : 'Find Music'}
      </button>

      {/* 8. Show the results or error message to the user */}
      <div>
        {error ? (
          <p style={{ color: 'red' }}>{error}</p>
        ) : null}
        
        {playlistId ? (
          <div>
            <h3>Success!</h3>
            <p>Your playlist is ready:</p>
            <a 
              href={`https://open.spotify.com/playlist/${playlistId}`}
              target="_blank" 
              rel="noopener noreferrer"
              style={{ color: 'green', fontWeight: 'bold' }} // Just some simple styling
            >
              Open Playlist on Spotify
            </a>
          </div>
        ) : null}
      </div>
    </main>
  );
}

