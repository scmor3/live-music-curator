const axios = require('axios');

// A simple helper function to pause execution
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Formats a 'YYYY-MM-DD' string into the required Bandsintown range.
function formatDateForBandsintown(dateStr) {
  const formattedDate = `${dateStr}T00:00:00,${dateStr}T23:00:00`;
  return formattedDate;
}
// Scrapes all artist names for a given city and date by paginating an API.
async function scrapeBandsintown(cityData, dateStr) {
  const formattedDate = formatDateForBandsintown(dateStr);
  let page = 1;
  const allArtistNames = [];
  
  // A "polite" User-Agent header, so we look like a real browser
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  };
  while (page) {
    const url = `https://www.bandsintown.com/choose-dates/fetch-next/upcomingEvents?city_id=${cityData.cityId}&date=${formattedDate}&page=${page}&longitude=${cityData.longitude}&latitude=${cityData.latitude}&genre_query=all-genres`;
    
    try {
      console.log(`Scraping page ${page} for ${dateStr}...`);
      const response = await axios.get(url, { headers });

      const events = response.data.events;

      // If the page is empty, we're done
      if (events.length === 0) {
        console.log('No more events found. Stopping.');
        break;
      }

      // Add the new artist names to our main list
      allArtistNames.push(...events.map(event => event.artistName));

      // Check if there's a next page. If not, we're done.
      if (!response.data.urlForNextPageOfEvents) {
        console.log('Last page reached. Stopping.');
        break;
      }

      // If we got here, there *is* a next page
      page += 1;
      await sleep(500); // Be polite and wait 500ms before the next request

    } catch (error) {
      console.error(`Error scraping page ${page}:`, error.message);
      break; 
    }
  }

  console.log(`Scraping complete. Found ${allArtistNames.length} total artist entries.`);
  return allArtistNames;
}

module.exports = { scrapeBandsintown };