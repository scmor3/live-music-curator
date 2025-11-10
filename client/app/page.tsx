"use client";

// Import 'useState' from React
import { useState, useEffect } from 'react';

type CitySuggestion = {
  name: string;
  latitude: number;
  longitude: number;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://172.17.236.175:3000';

export default function HomePage() {
  // --- 1. Define our State ---
  // State for the city autocomplete
  const [searchQuery, setSearchQuery] = useState(''); // What the user is typing, e.g., "Aust"
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]); // The list of results, e.g., ["Austin, TX", "Austin, MN"]
  const [selectedCity, setSelectedCity] = useState<CitySuggestion | null>(null); // The final city the user clicked on

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
  maxDate.setDate(today.getDate() + 30);
  const maxDateString = maxDate.toISOString().split('T')[0];
  
    // --- 3. Autocomplete API Logic (with Debouncing) ---
  useEffect(() => {
    // Clear suggestions if the search query is empty
    if (searchQuery.trim() === '') {
      setSuggestions([]);
      return;
    }
    
    // This is our "debounce" timer.
    // It waits 300ms after the user stops typing before calling the API.
    const timer = setTimeout(async () => {
      try {
        // Call our new backend endpoint
        const response = await fetch(`${API_URL}/api/search-cities?q=${encodeURIComponent(searchQuery)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch city suggestions');
        }
        const data = await response.json();
        setSuggestions(data); // Update the state with the new suggestions
      } catch (err) {
        console.error('Error fetching city suggestions:', err);
        setSuggestions([]); // Clear suggestions on error
      }
    }, 300); // Wait 300ms

    // This is the "cleanup" function.
    // If the user types again, this clears the *previous* timer,
    // which cancels the old, stale API request.
    return () => clearTimeout(timer);
    
  }, [searchQuery]); // This "effect" re-runs *only* when the 'searchQuery' state changes
  
  // --- 4. Handler Functions ---

  /**
   * Runs when the user types in the city input box.
   */
  const handleCitySearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    // If the user is typing again, their old selection is invalid.
    setSelectedCity(null); 
    // Clear any old results or errors
    setPlaylistId('');
    setError('');
  };

  /**
   * Runs when the user clicks on a city in the suggestion dropdown.
   */
  const handleSuggestionClick = (city: CitySuggestion) => {
    setSelectedCity(city);         // Save the *entire* city object (with lat/lon)
    setSearchQuery(city.name);     // Put the full, correct name in the search box
    setSuggestions([]);            // Close the dropdown
  };
  /**
   * This function runs when the user clicks "Create"
   */
  const handlePlaylistCreation = async () => {
    // We now check if a city has been *selected*, not just typed
    if (!selectedCity) {
      setError('Please select a valid city from the dropdown.');
      return;
    }
    // We must validate the date *before* making an API call
    if (!date) {
      setError('Please select a date.');
      return;
    }
    if (date < todayString || date > maxDateString) {
      setError('Please select a valid date (today or up to 30 days from now).');
      return;
    }
    console.log('Button clicked!');
    console.log('User selected city:', selectedCity.name);
    console.log('User selected date:', date);

    // --- Start the API Call ---
    setIsLoading(true); // Show loading spinner
    setError(''); // Clear any old errors
    setPlaylistId(''); // Clear any old results

    try {
      // Build the URL for our backend API
      const queryParams = new URLSearchParams({
        city: selectedCity.name,
        date: date,
        lat: selectedCity.latitude.toString(), // Convert number to string for URL
        lon: selectedCity.longitude.toString()  // Convert number to string for URL
      });
      // We're calling our own server, which is on port 3000
      // Use the WSL IP address for the fetch request
      const response = await fetch(`${API_URL}/api/playlists?${queryParams}`);

      if (!response.ok) {
        // Try to get the error message from the server's JSON response
        const errorData = await response.json().catch(() => ({})); // .catch() prevents a second crash if .json() fails
        const errorMessage = errorData.error || `HTTP error! status: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Get the JSON data from the response
      const data = await response.json();
      
      if (data.playlistId) {
        setPlaylistId(data.playlistId); // Success! Save the result
      } else {
        // Handle cases where the server responded OK but had no ID
        throw new Error('No playlist ID found in response.');
      }

    } catch (err) {
      // Handle any errors during the fetch
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
      // This runs no matter what (success or error)
      setIsLoading(false); // Hide loading spinner
    }
  };

  return (
    // --- Page layout: dark background, content centered ---
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-pastel-yellow">
      
      {/* --- Centered "card" with a color flush with background --- */}
      <div className="p-8 w-full max-w-lg text-center">

        {/* --- Content with warm, light text colors --- */}
        <h1 className="text-3xl font-bold text-night-blue mb-2">Live Music Curator</h1>
        <p className="text-black mb-6">
          Enter a city and date to create a playlist of artists playing music anywhere in the world sometime in the next 30 days.
        </p>
        {/* --- Form layout wrapper --- */}
        <div className="flex flex-col items-center gap-4 mt-4">

          {/* --- NEW: City Autocomplete Wrapper --- */}
          {/* 'relative' is crucial for positioning the dropdown */}
          <div className="w-full max-w-xs relative">
            <label htmlFor="city-search" className="block text-sm font-medium text-black mb-1">
              Select a City:
            </label>
            <input 
              type="text"
              id="city-search"
              value={searchQuery}
              onChange={handleCitySearch}
              placeholder="Smallville, Kansas"
              disabled={isLoading}
              // 'w-full' makes it fill the 'max-w-xs' container
              className="p-2 border border-zinc-600 rounded-lg text-stone-100 bg-zinc-700 w-full"
            />
            {/* --- NEW: Suggestions Dropdown --- */}
            {/* This list only renders if there are suggestions */}
            {suggestions.length > 0 && (
              <ul className="absolute z-10 w-full bg-zinc-700 border border-zinc-600 rounded-lg mt-1 max-h-60 overflow-y-auto">
                {suggestions.map((city) => (
                  <li 
                    key={city.name} // React needs a unique key
                    onClick={() => handleSuggestionClick(city)}
                    className="p-2 text-left text-stone-100 hover:bg-amber-600 hover:text-zinc-900 cursor-pointer"
                  >
                    {city.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* --- END: City Autocomplete --- */}

          {/* --- Date Picker --- */}
          {/* This is now a direct child of the 'gap-4' flex container */}
          <div className="w-full max-w-xs">
            <label htmlFor="date-picker" className="block text-sm font-medium text-black mb-1">
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
          </div>

          {/* --- Submit Button --- */}
          {/* This is now a direct child of the 'gap-4' flex container */}
          <button 
            onClick={handlePlaylistCreation} 
            disabled={isLoading || !selectedCity || !date}
            className="py-2 px-4 bg-dark-pastel-green text-zinc-900 font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 mt-2"
          >
            {isLoading ? 'Creating Playlist...' : 'Create'}
          </button>
        </div>

        {/* --- Results Area --- */}
        <div className="mt-6">
          
          {error ? (
            <p className="text-red-500">{error}</p>
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

