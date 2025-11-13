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
  // Define our State
  // State for the city autocomplete
  const [searchQuery, setSearchQuery] = useState(''); // What the user is typing, e.g., "Aust"
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]); // The list of results, e.g., ["Austin, TX", "Austin, MN"]
  const [selectedCity, setSelectedCity] = useState<CitySuggestion | null>(null); // The final city the user clicked on
  const [excludedGenres, setExcludedGenres] = useState<string[]>([]); // Holds the selected genres
  const [showGenres, setShowGenres] = useState(false);
  
  const [date, setDate] = useState('');
  
  // We need state variables to track the API call
  const [playlistId, setPlaylistId] = useState(''); // To store the final result
  const [isLoading, setIsLoading] = useState(false); // To show a loading spinner
  const [error, setError] = useState(''); // To show any error messages

  // This is where we'll store the "receipt" (the ID) we get back from the server.
  const [jobId, setJobId] = useState('');
  // This will hold user-friendly text like "Your job is pending..." or "Building...".
  const [pollingStatusMessage, setPollingStatusMessage] = useState('');
  

  // Get today's date and format it
  const today = new Date();
  const todayString = today.toISOString().split('T')[0];
  // Get the date 30 days from now
  const maxDate = new Date();
  maxDate.setDate(today.getDate() + 30);
  const maxDateString = maxDate.toISOString().split('T')[0];
  
    // Autocomplete API Logic (with Debouncing)
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
        const response = await fetch(`${API_URL}/api/search-cities?q=${encodeURIComponent(searchQuery)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch city suggestions');
        }
        const data = await response.json();
        setSuggestions(data);
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
  
  // This helper function will check the job status
  const checkJobStatus = async (id: string) => {
    try {
      const response = await fetch(`${API_URL}/api/playlists/status?jobId=${id}`);
      if (!response.ok) {
        // If the status check fails, we can just let the poller try again
        console.warn(`Status check failed with status: ${response.status}`);
        return; 
      }

      const data = await response.json();

      switch (data.status) {
        case 'pending':
          setPollingStatusMessage('Your job is in the queue...');
          break;
        case 'building':
          setPollingStatusMessage('Building your playlist... this may take a minute.');
          break;
        case 'complete':
          // --- SUCCESS! ---
          setJobId(''); // Clear the job ID
          setIsLoading(false); // Stop loading
          setPlaylistId(data.playlistId); // Set the final playlist ID
          setPollingStatusMessage(''); // Clear the status
          break;
        case 'failed':
          // --- FAILED! ---
          setJobId(''); // Clear the job ID
          setIsLoading(false); // Stop loading
          setError(data.error || 'The job failed for an unknown reason.');
          setPollingStatusMessage(''); // Clear the status
          break;
      }
    } catch (err) {
      console.error('Error during polling:', err);
      // We don't stop polling, just let the next interval try again
    }
  };

  // This effect runs whenever 'jobId' changes
  useEffect(() => {
    if (jobId) {
      // A job is active. Start polling.
      // We check immediately, *then* start the interval
      checkJobStatus(jobId); 

      const interval = setInterval(() => {
        checkJobStatus(jobId);
      }, 5000); // Poll every 5 seconds

      // This is the "cleanup" function.
      // It runs if the component unmounts OR if jobId changes again.
      return () => clearInterval(interval);
    }
  }, [jobId]); // This hook is sensitive *only* to the 'jobId'

  // --- Handler Functions ---

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
   * Runs when a user checks or unchecks a genre box.
   */
  const handleGenreChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = e.target;
    
    if (checked) {
      // It was checked: add it to the array
      setExcludedGenres(prev => [...prev, value]);
    } else {
      // It was unchecked: filter it out of the array
      setExcludedGenres(prev => prev.filter(genre => genre !== value));
    }
  };
  /**
   * This function runs when the user clicks "Create"
   * It now just SUBMITS a job, it doesn't wait for completion.
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
    setPollingStatusMessage('Submitting your request...');

    try {
      // Build the URL for our backend API
      const queryParams = new URLSearchParams({
        city: selectedCity.name,
        date: date,
        lat: selectedCity.latitude.toString(), // Convert number to string for URL
        lon: selectedCity.longitude.toString()  // Convert number to string for URL
      });

      // If the user has selected any genres...
      if (excludedGenres.length > 0) {
        // ...join them into a single, comma-separated string
        const genreString = excludedGenres.join(',');
        queryParams.append('genres', genreString); // 'genres' (plural)
      }

      const response = await fetch(`${API_URL}/api/playlists?${queryParams}`);

      // We're expecting a 202 (Accepted) or 200 (OK)
      if (!response.ok) {
        // Try to get the error message from the server's JSON response
        const errorData = await response.json().catch(() => ({})); // .catch() prevents a second crash if .json() fails
        const errorMessage = errorData.error || `HTTP error! status: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Get the JSON data from the response
      const data = await response.json();

      if (data.jobId) {
        // SUCCESS! We got a job ID
        setJobId(data.jobId); // This is the key. We save the job ID.
        setPollingStatusMessage('Your job is in the queue...');
      } else {
        throw new Error('Server did not return a valid job ID.');
      }

    } catch (err) {
      // Handle any errors during the *submission*
      console.error('Error creating playlist job:', err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred. Please try again.');
      }
      setIsLoading(false); // Stop loading if submission fails
    }
    // We DON'T set isLoading(false) on success,
    // because the polling is about to begin.
  };

  return (
    // --- Page layout: dark background, content centered ---
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-pastel-yellow">
      
      {/* --- Centered "card" with a color flush with background --- */}
      <div className="p-8 w-full max-w-lg text-center">

        {/* --- Content with warm, light text colors --- */}
        <h1 className="text-3xl font-bold text-night-blue mb-2">Live Music Curator</h1>
        <p className="text-black mb-6">
          Enter a city and date to create a playlist of artists playing music anywhere in the world in the next 30 days.
        </p>
        {/* --- Form layout wrapper --- */}
        <div className="flex flex-col items-center gap-4 mt-4">

          {/* --- City Autocomplete Wrapper --- */}
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
            {/* --- Suggestions Dropdown --- */}
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
          {/* --- END: Date Picker --- */}

          {/* --- COLLAPSIBLE GENRE FILTER --- */}
          <div className="w-full max-w-xs text-center">
            
            {/* The Toggle Button */}
            <button 
              onClick={() => setShowGenres(!showGenres)} 
              className="text-sm text-zinc-600 hover:text-black underline underline-offset-2 decoration-zinc-400 hover:decoration-black transition-all"
              type="button"
            >
              {showGenres ? 'Hide Filters' : 'Exclude Genres (Optional)'}
            </button>

            {/* The Content (Checkboxes) */}
            {showGenres && (
              <div className="mt-3 text-left"> 
                {/* Added text-left here so the checkboxes align nicely */}
                <div className="p-3 border border-zinc-600 rounded-lg bg-zinc-700 grid grid-cols-2 gap-2">
                  {[
                    'Country', 'Rock', 'Pop', 'Hip Hop', 
                    'Electronic', 'Jazz', 'R&B / Soul', 'Folk & Acoustic'
                  ].map((genre) => (
                    <label key={genre} className="flex items-center space-x-2 text-stone-100 cursor-pointer">
                      <input
                        type="checkbox"
                        value={genre.toLowerCase()}
                        checked={excludedGenres.includes(genre.toLowerCase())}
                        onChange={handleGenreChange}
                        disabled={isLoading}
                        className="rounded text-amber-600 focus:ring-amber-500"
                      />
                      <span className="text-sm">{genre}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-zinc-600 mt-1 px-1">
                  Note: We'll try to filter, but many artists don't have genre tags on Spotify.
                </p>
              </div>
            )}
          </div>
          {/* --- END: COLLAPSIBLE GENRE FILTER --- */}

          {/* --- Submit Button --- */}
          {/* This is now a direct child of the 'gap-4' flex container */}
          <button 
            onClick={handlePlaylistCreation} 
            disabled={isLoading || !selectedCity || !date}
            className="py-2 px-4 bg-dark-pastel-green text-zinc-900 font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 mt-2"
          >
            {isLoading ? (pollingStatusMessage || 'Loading...') : 'Create'}
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
                Click to open Playlist on Spotify
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

