# General Notes (high level)

What?  
A web app that generates a Spotify playlist of artists performing on a selected date in a selected city. The playlist is created on a master Spotify account and users can save it to their library.

Why?  
I want to have a simple passive way of exploring what live music is available in a given place on a given date. Other solutions don't solve this in the way I want. Some other solutions include:
* Bandsintown: Provides a list of bands playing in a given city on a given date where you can click on each one individually and click another button to hear their top songs on spotify. This require too much attention an activity to go through each artist this way.
* Spotify: Provides a playlist of recommended artist playing shows in the near future, but not specific to a date or artist. Obviously doesn't serve the same need.
* City Sounds: sends user playlists of artists playing soon in given city. User has some control over genre, but not over date of shows.

I also want to get up to date on modern popular tech stacks and refresh my software development skills, so I will use popular javascript frameworks and other popular tools for implementation.

How?  
The user can sign in anonymously or create an account via Supabase Auth (email/password). They input a city (via autocomplete search or location services), a date, and optionally filter by excluded genres and time range. The app scrapes Bandsintown for all artists playing in that city on that date, matches them to Spotify artists, and creates a playlist on a master Spotify account containing the top 1 song from each artist (number is currently hardcoded). Users can save playlists to their personal library and refresh them later.

Technical Architecture:
* **Frontend**: Next.js (React/TypeScript) with Supabase client for authentication
* **Backend**: Express.js server with PostgreSQL database (Supabase)
* **Data Source**: Bandsintown scraper (uses got-scraping library first, falls back to Playwright with browser automation if blocked)
* **Authentication**: Supabase Auth - users can sign in anonymously or with email/password
* **Job Queue**: Asynchronous background job processing with worker threads. Jobs are stored in `playlist_jobs` table with status: pending, building, complete, or failed
* **Database**: PostgreSQL with PostGIS extension for geographic queries, pg_trgm for fuzzy city search
* **Spotify Integration**: Uses a master Spotify account with refresh token to create playlists. Playlists are created on this master account, not user accounts
* **City Search**: Uses trigram similarity index for fast fuzzy autocomplete. Also supports geographic coordinate lookup using PostGIS

Data Completeness:
Data completeness is very important to me. I don't want to use the most convenient data source for live music events only for the user to have a playlist of the big bands playing the big arenas. I want the user to get a playlist that exposes them to small and big artists alike. The app scrapes Bandsintown's API by paginating through all available events for a given date and location. The scraper uses got-scraping (lightweight HTTP requests) first, but falls back to Playwright (full browser automation) if it gets blocked by Cloudflare. This ensures we capture as many events as possible, including smaller local venues.

Edge cases (implemented):
* A given artist has less than 1 song available on Spotify.
    * Automatically handled - the `slice(0, number_of_songs)` will return whatever is available (0 to number_of_songs)
* Misspelling in search for artist.
    * Uses exact match first (case-insensitive), then Levenshtein distance with threshold of 1 character difference for fuzzy matching
* Artist doesn't exist on spotify, but there are still search results.
    * If no exact or close match found (within Levenshtein threshold), the artist is skipped and logged
* Duplicate artists.
    * Deduplicated by artist name (case-insensitive) before processing. Also tracks processed Spotify artist IDs to avoid adding same artist twice with different name variations
* The same search is done more than once.
    * Job queue system checks for existing jobs with same city, date, filters. If found, returns existing job instead of creating duplicate. Users can refresh saved playlists to regenerate with updated data
* Genre filtering.
    * Users can exclude genres. System uses genre synonym expansion (e.g., excluding "hip hop" also excludes "rap") to catch related genres
* Time filtering.
    * Users can specify min and max start times (in 24-hour format) to filter events by when they start
* Empty playlists.
    * If no tracks are successfully added, the playlist is automatically deleted from Spotify and job is marked as failed
* Rate limiting and retries.
    * Handles Spotify API rate limits (429) and server errors (5xx) with exponential backoff retry logic (max 3 retries per artist)
* Zombie jobs.
    * Background workers detect jobs stuck in "building" status for >30 minutes and mark them as failed
* Cloudflare blocking.
    * Scraper detects Cloudflare blocks and automatically falls back from lightweight HTTP requests to full browser automation (Playwright)

Current Limitations:
* Number of songs per artist is hardcoded to 1 (not configurable by user)
* Playlists are created on master Spotify account, not user's personal account (users save references in their library instead)
* Anonymous users can create playlists but must sign up to save them to their library

Potential future features:
* Make number of songs per artist configurable (1-5)
* Connect with other people looking for live music in a given city
* Filter by included genres (currently only supports excluding)
* expand past spotify to apple music, sound cloud, youtube, etc.
* get smaller venues to list their shows or scrape their websites.
* "pay when you feel like it" button. adds $1 every time a playlist is created. Can pay some or all of it down whenever they want.
* Query multiple APIs to aggregate live shows in a particular city e.g. Songkick *and* bandsintown
* Users can subscribe to a particular city and just get a playlist made every day or weekend or whatever
* connect fans to artists somehow - maybe through location sharing during concerts to build 'points' with the artist and get free merch or something
* build out the venue playlists… their social manager may be convinced to sponsor an auto updating playlist for their venue.
* Use LLMs to gather smaller venue events
* have playlists created that day show up around the front page for users to follow if they want
* Create playlists directly in user's Spotify account instead of master account (requires Spotify OAuth integration)