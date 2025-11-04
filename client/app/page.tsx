"use client";

// Import 'useState' from React
import { useState } from 'react';

export default function HomePage() {
  // --- 1. Define our State ---
  const [date, setDate] = useState('');
  
  // We need new state variables to track the API call
  const [playlistId, setPlaylistId] = useState(''); // To store the final result
  const [isLoading, setIsLoading] = useState(false); // To show a loading spinner
  const [error, setError] = useState(''); // To show any error messages
  // Get today's date and format it
  const today = new Date();
  const todayString = today.toISOString().split('T')[0];
  // Get the date 30 days from now
  const maxDate = new Date();
  maxDate.setDate(today.getDate() + 7);
  const maxDateString = maxDate.toISOString().split('T')[0];
  /**
   * This function runs when the user clicks "Create"
   */
  const handlePlaylistCreation = async () => {
    console.log('Button clicked!');
    console.log('User selected date:', date);
    // We must validate the date *before* making an API call
    if (!date) {
      setError('Please select a date.');
      return; // Stop the function
    }
    if (date < todayString || date > maxDateString) {
      setError('Please select a date within the next 7 days.');
      return; // Stop the function
    }
    // --- 2. Start the API Call ---
    setIsLoading(true); // Show loading spinner
    setError(''); // Clear any old errors
    setPlaylistId(''); // Clear any old results
    
    const city = 'Austin, TX'; // Hardcoded for V1

    try {
      // 3. Build the URL for our backend API
      const queryParams = new URLSearchParams({
        city: city,
        date: date
      });
      
      // We're calling our own server, which is on port 3000
      // Use the WSL IP address for the fetch request
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
    // --- Page layout: dark background, content centered ---
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-pastel-yellow">
      
      {/* --- Centered "card" with a slightly lighter dark background --- */}
      <div className="p-8 w-full max-w-lg text-center">

        {/* --- Content with warm, light text colors --- */}
        <h1 className="text-3xl font-bold text-night-blue mb-2">Live Music Curator</h1>
        <p className="text-black mb-6">Enter a date to create a playlist of artists playing music in Austin, TX sometime in the next week.</p>
        
        {/* --- Form layout wrapper --- */}
        <div className="flex flex-col items-center gap-2 mt-4">
  <label htmlFor="date-picker" className="text-sm font-medium text-black mb-1">
    Select a date:
  </label>
  {/* TODO: change date picker from default browser option to avoid greyed out year */}
  <input 
    type="date"
    id="date-picker"
    value={date} 
    onChange={(e) => setDate(e.target.value)} 
    min={todayString}
    max={maxDateString}
    disabled={isLoading}
    className="p-2 border border-zinc-600 rounded-lg text-champagne-pink bg-grey-blue color-scheme-dark"
  />
  <button 
    onClick={handlePlaylistCreation} 
    disabled={isLoading}
    className="py-2 px-4 bg-dark-pastel-green text-zinc-900 font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 mt-2"
  >
    {isLoading ? 'Creating Playlist...' : 'Create'}
  </button>
</div>

        {/* 8. Show the results or error message to the user */}
        <div className="mt-6">
          
          {error ? (
            <p className="text-red-500">{error}</p> // Errors are still red (which is a warm color!)
          ) : null}
          
          {playlistId ? (
            <div className="border-t border-zinc-700 pt-4 mt-4">
              <h3 className="text-xl font-semibold text-night-blue">Success!</h3>
              <p className="text-black">Your playlist is ready:</p>
              <a 
                href={`https://open.spotify.com/playlist/${playlistId}`}
                target="_blank" 
                rel="noopener noreferrer"
                className="text-dark-pastel-green font-bold hover:underline"
              >
                Open Playlist on Spotify
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

