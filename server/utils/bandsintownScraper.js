const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');

chromium.use(stealth());

const PROXY_URL = process.env.PROXY_URL;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;

const ENABLE_DEBUG = true; // Set to false to silence logs

// Helper function to pause execution
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Formats a 'YYYY-MM-DD' string into the required Bandsintown range.
 */
function formatDateForBandsintown(dateStr) {
  const formattedDate = `${dateStr}T00:00:00,${dateStr}T23:00:00`;
  return formattedDate;
}
/**
 * Scrapes all artist names for a given date and location by paginating an API.
 * We now pass in the latitude and longitude.
 */
async function scrapeBandsintown(dateStr, latitude, longitude) {
  const formattedDate = formatDateForBandsintown(dateStr);
  const allArtistNames = [];
  let pageNum = 1;
  let browser = null

  // --- 1. INITIALIZATION & LOGGING ---
  console.log(`[PROXY CONFIG] URL: ${PROXY_URL || 'MISSING'}, PORT: ${PROXY_PORT || 'MISSING'}, USER: ${PROXY_USER ? 'SET' : 'NOT SET'}`);
  // Generate a unique session ID for this entire function call (City + Date)
  // This keeps our IP stable during pagination but rotates it for the next city search.
  const sessionId = `session_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  if (ENABLE_DEBUG) {
    console.log(`[SCRAPER] Starting job for ${dateStr} at ${latitude},${longitude}`);
    console.log(`[PROXY] Session ID: ${sessionId}`);
  }

  try {
    // --- 2. PROXY SETUP ---
    // We build the launch options object dynamically based on whether proxy vars exist.
    let launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ]
    };

    if (PROXY_URL && PROXY_PORT && PROXY_USER && PROXY_PASS) {
      if (ENABLE_DEBUG) console.log(`[PROXY] Configuring Oxylabs agent with Session ID: ${sessionId}`);
      
      // Construct proxy object for Playwright
      launchOptions.proxy = {
        server: `http://${PROXY_URL}:${PROXY_PORT}`,
        username: `${PROXY_USER}-sessid-${sessionId}`,
        password: PROXY_PASS,
      };
    } else {
      console.warn('[PROXY] WARNING: Proxy credentials missing. Running directly (High risk of blocking).');
    }

    // Launch the browser with the options defined above
    browser = await chromium.launch(launchOptions);

    const context = await browser.newContext({
      ignoreHTTPSErrors: true, 
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    });

    // Block heavy resources to speed up scraping (images, fonts, css)
    await context.route('**/*.{png,jpg,jpeg,gif,css,woff,woff2}', route => route.abort());

    const page = await context.newPage();

    // --- 3. PAGINATION LOOP ---
    // Using while(true) to handle multiple exit conditions explicitly
    while (true) {
      const apiUrl = `https://www.bandsintown.com/choose-dates/fetch-next/upcomingEvents?date=${formattedDate}&page=${pageNum}&longitude=${longitude}&latitude=${latitude}&genre_query=all-genres`;
      
      if (ENABLE_DEBUG) console.log(`[PAGE ${pageNum}] Navigating to API...`);

      // Go to the URL and capture the response object
      const response = await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const status = response.status();

      // --- 4. STATUS CODE HANDLING ---
      // Playwright doesn't throw errors on 403/429, so we check manually.
      if (status === 403 || status === 429) {
        console.error(`\n🛑 CRITICAL 4xx BLOCK (Page ${pageNum}). Likely IP Block or Rate Limit.`);
        console.error(`   Status: ${status}`);
        console.error(`   URL: ${apiUrl}`);
        console.error(`   Headers:`, response.headers());
        // Break the loop to save what we have so far
        break; 
      }

      if (status !== 200) {
        console.warn(`[WARNING] Non-200 status received: ${status}. Attempting to parse anyway...`);
      }

      // Get raw text from body
      const pageContent = await page.evaluate(() => document.body.innerText);

      let data;
      try {
        // --- 5. JSON PARSING SAFETY ---
        // If we get a CAPTCHA page, this line will fail because it's HTML, not JSON.
        data = JSON.parse(pageContent);
      } catch (e) {
        console.error(`[ERROR] Failed to parse JSON on page ${pageNum}.`);
        console.error(`[DIAGNOSTIC] Content Start: ${pageContent.substring(0, 100)}...`);
        console.error(`[DIAGNOSTIC] This usually means a 'Soft Block' or CAPTCHA page was returned instead of data.`);
        break; // Stop scraping if we can't read the data
      }

      const events = data.events || [];

      // EXIT CONDITION 1: No events returned
      if (events.length === 0) {
        if (ENABLE_DEBUG) console.log('[INFO] No events found on this page. Finished.');
        break;
      }

      const artistsOnPage = events.map(event => event.artistName);
      allArtistNames.push(...artistsOnPage);

      if (ENABLE_DEBUG) console.log(`[PAGE ${pageNum}] Found ${artistsOnPage.length} artists.`);

      // EXIT CONDITION 2: API says no next page
      if (!data.urlForNextPageOfEvents) {
        if (ENABLE_DEBUG) console.log('[INFO] Reached last page according to API.');
        break;
      }

      pageNum++;
      await sleep(1000); // Polite pause
    }

  } catch (error) {
    console.error(`[CRITICAL ERROR] Scraper failed: ${error.message}`);
  } finally {
    if (browser) {
      if (ENABLE_DEBUG) console.log('[CLEANUP] Closing browser...');
      await browser.close();
    }
  }

  if (ENABLE_DEBUG) console.log(`[COMPLETE] Total artists found: ${allArtistNames.length}`);
  return allArtistNames;
}

module.exports = { scrapeBandsintown };