# API Flow Notes

#### Section 1: User Authentication Flow (OAuth 2.0 - first login):
 story:
 1. User logs in via spotify login link.
 2. User grants our application permission.
 3. User gets redirected back to our registered **Redirect URI** which contains a temporary authorization code.
 4. Our server trades the authorization code for a permanent refresh token and a temporary access token.
 5. Our server uses the updated access token to get the users spotify id and display name.
 6. Our server saves the user and associated info in the user table in our database.
 7. The server sends a redirect to the user's browser, sending them to the home page of our app.
 
For subsequent logins the user will skip granting our application permission and the user will directly get redirected to our registered **Redirect URI** with an auth code. We will simply fetch the user's info from the user table and we will send him to the home page with an updated refresh token if a new one was provided.

#### Section 2: Playlist Curation Flow
story:
1. Data submission: User submits `city`, `date` and `number_of_songs` (1-5).
2. Client request: The frontend sends the user's input to a dedicated backend endpoint, like /api/curate.
3. Create playlist: Our server uses the user's `access_token` to create a new, empty playlist on their spotify account.
4. Curation iteration: The server loops through each artist name from the curated artists list. For each artist:
    * Search Spotify API for potential matches
    * Apply `confidence_score` logic to identify best match
    * Fetch `number_of_songs` top tracks from selected artist
    * Add tracks to new playlist
5. Save to Database: After the loop is complete, our server saves the results of the entire operation () into our `curation_requests` and `curated_artists` tables.
    * `curation_requests` table: The user's inputs: The user_id, search_city, search_date, and number_of_songs
    * `curated_artists` table: an itemized list containing `curation_request_id`, `artist_name_raw`, `spotify_artist_id`, and `confidence_score` for each artists found in the curation search (1 row each).
6. Server Response: The server sends a confirmation back to the client, including the ID of the newly created Spotify playlist.
