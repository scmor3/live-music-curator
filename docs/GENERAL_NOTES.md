# General Notes (high level)

What?  
A web app that generates a Spotify playlist for the user of artists performing on a selected date in a selected city.

Why?  
I want to have a simple passive way of exploring what live music is available in a given place on a given date. Other solutions don't solve this in the way I want. Some other solutions include:
* Bandsintown: Provides a list of bands playing in a given city on a given date where you can click on each one individually and click another button to hear their top songs on spotify. This require too much attention an activity to go through each artist this way.
* Spotify: Provides a playlist of recommended artist playing shows in the near future, but not specific to a date or artist. Obviously doesn't serve the same need.
* City Sounds: sends user playlists of artists playing soon in given city. User has some control over genre, but not over date of shows.

I also want to get up to date on modern popular tech stacks and refresh my software development skills, so I will use popular javascript frameworks and other popular tools for implementation.

How?  
The user logs in via Spotify, inputs city/state, a date, and how many songs they want to listen to from each artist (let’s call that number x - between 1 and 5). The app creates a playlist in the user’s Spotify account containing the top x songs from each artist playing in the input city on the input date.  
Important Note: Data copmleteness is very important to me. I don't want to use the most convenient data source for live music events only for the user to have a playlist of the big bands playing the big arenas. I want the user to get a playlist that exposes them to small and big artists alike. The best dataset I've seen so far is from bandsintown and even they are missing what's going on in many local venues for each city. They also don't have a public API that allows us to easily pull a list of live shows in a city on a given date. We could scrape their website, but to start I think we'll focus on figuring out the best way to make the most complete list of artists for one city on each day and go from there. Maybe that starts pretty manually.

Edge cases:
* A given artist has less than x songs available on Spotify.
    * Do a check and pull all songs if artist has equal to or less than x songs.
* Misspelling in search for artist.
    * Use some heuristic to find the most likely match such as popularity score.
* Artist doesn’t exist on spotify, but there are still search results.
    * Use some heuristic such as how close results are in spelling to search input.
* The same search is done more than once by the same user.
    * check if the first playlist still exists. If same number of songs input, check if there are any new artists playing in the input city and on the input date and add their top songs to the playlist. If different number of songs, create new playlist. If playlist doesn't exist, just create new playlist.
* User spams creating playlists
    * limit number of playlists that can be created per hour or day or something.

Steps:
1. Initiate new github repo
2. Add folders that will contain backend logic, frontend logic, and a place to store documents related to the project for viewers to get more context
3. 




Potential future features:
* Connect with other people looking for live music in a given city
* Filter by genre.
* Use location services to suggest user's location.
* expand past spotify to apple music, sound cloud, youtube, etc.
* get smaller venues to list their shows or scrape their websites.
* "pay when you feel like it" button. adds $1 every time a playlist is created. Can pay some or all of it down whenever they want.
* could save API calls by only creating a playlist once for a given city and date and having other users that ask for that playlist to follow the existing playlist rather than create a new one in their account. The playlist may need to be updated if a new user requests it on a date after the date of its original creation.
* Query multiple APIs to aggregate live shows in a particular city e.g. Songkick *and* bandsintown
* Users can subscribe to a particular city and just get a playlist made every day or weekend or whatever
* connect fans to artists somehow - maybe through location sharing during concerts to build 'points' with the artist and get free merch or something
* build out the venue playlists… their social manager may be convinced to sponsor an auto updating playlist for their venue.
* Use LLMs to gather smaller venue events
* have playlists created that day show up around the front page for users to follow if they want