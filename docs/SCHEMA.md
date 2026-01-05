## This document is out of date and requires a comprehensive update

# Database Schema Notes

Thinking about the database schema:  
What is the story?
User logs in via their spotify account. They choose a city from a list. They choose a date. They choose a number, x (1-5) of songs to listen to from each artist. A list of artists are fetched from some source. For each artist a search is conducted on Spotify in order to return a list of x songs for each artist. A playlist is created on Spotify. Each song is added to the playlist. It could be that first we create a playlist and for each artist we add their x top songs one at a time before going to the next artist. The program in complete once we've added x songs from every artist on the list to the new playlist.
What are the **nouns** of the user story?
* The user
* The user's spotify account
* A list of cities to choose from
* The city chosen by the user
* The date chosen by the user
* The number of top songs for each artist chosen by the user
* The list of artists
* The individual artists in the list
* The playlist being created
* The individual songs in the playlist  

What nouns do we not need to store?  
* The list of cities - it is static and is the same across all userss, so can be a simple configuration file
* The songs - stored by Spotify in the playlist

What are **core nouns** that can contain groups of nouns (fields)?  
* The User `users` - properties -:
    * Authentication credentials for login/APIs like `spotify_id`
* The Curation Request `curation_requests` - properties:
    * unique user id `user_id`
    * chosen city `search_city`
    * chosen date `search_date`
    * number of top songs from each artist `number_of_songs`
    * resulting playlist created `playlist_id`
* resulting list of artists from a curation request `curated_artists`
    * an id referring to which curation_request the artist is associated with which should be a foreign key `curation_request_id`
    * Artist Name from source `artist_name_raw`
    * unique spotify id `spotify_artist_id`
    * Confidence score - based on popularity score and spelling of results `confidence_score`

### Slightly more formalized (adding more fields as we go)
3 tables:  
1. `users` - stores one row for every person using the app
    * `id` - primary key to identify each user
    * `display_name` - Their display name on Spotify or their chosen username for the app
    * `email` - user's email they use for spotify
    * `profile_picture` - user's profile picture they use for spotify if any
    * `spotify_id` - a user's id unique to their spotify profile
    * `refresh_token` - used to get an access token for spotify authorization
    * other credentials...
2. `curation_requests` - stores one row for every search a user performs
    * `id` - primary key for each request
    * `user_id` - foreign key that links back to the `users` table
    * `search_city`
    * `search_date`
    * `number_of_songs`
    * `playlist_id`
3. `curated_artists` - stores one row for every artist found in every search
    * `id` - primary key to identify each artist entry
    * `curation_request_id` - foreign key that links back to the `curation_requests` table
    * `artist_name_raw` - the artist name in raw text
    * `spotify_artist_id` - corrensponding unique id for artist on Spotify
    * `confidence_score` - the result of our matching logic

#### Column rules:
1. `users`
    * `id` - data type: SERIAL constraints: PRIMARY KEY
    * `spotify_id` - data type: VARCHAR(255) constraints: NOT NULL, UNIQUE
    * `display_name` - data type: VARCHAR(255) constraints: NOT NULL
    * `email` - data type: VARCHAR(255) constraints: NOT NULL, UNIQUE
    * `profile_picture` - data type: VARCHAR(255)
    * `refresh_token` - data type: TEXT, constraints: NOT NULL
2. `curation_requests`
    * `id` - data type: constraints: SERIAL PRIMARY KEY
    * `user_id` - data type: INT constraint: FOREIGN KEY
    * `search_city` - data type: VARCHAR(255) constraints: NOT NULL
    * `search_date` - data type: DATE constraints: NOT NULL
    * `number_of_songs` - data type: INT constraints: NOT NULL
    * `playlist_id` - data type: TEXT constraint: UNIQUE
3. `curated_artists`
    * `id` - data type: SERIAL constraints: PRIMARY KEY
    * `curation_request_id` - data type: INT constraint: FOREIGN KEY
    * `artist_name_raw` - data type: VARCHAR(255) constraing: NOT NULL
    * `spotify_artist_id` - data type: TEXT
    * `confidence_score` - data type: DECIMAL(5, 2)

