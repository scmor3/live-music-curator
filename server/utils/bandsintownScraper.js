const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');

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
 * MAIN CONTROLLER
 * 1. Tries 'got-scraping' (Fast/Cheap).
 * 2. If 'got' fails, is blocked, or returns 0 results, falls back to Playwright (Heavy/Robust). * Scrapes all artist names for a given date and location by paginating an API.
 * We now pass in the latitude and longitude.
 */
async function scrapeBandsintown(dateStr, latitude, longitude) {
  const sessionId = `session_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  if (ENABLE_DEBUG) {
    console.log(`[SCRAPER] Starting job for ${dateStr} at ${latitude},${longitude}`);
    console.log(`[PROXY] Session ID: ${sessionId}`);
  }

  // [DEBUG] FORCE PLAYWRIGHT: Set this to TRUE to skip 'got-scraping'
  const FORCE_PLAYWRIGHT = false;

  // --- ATTEMPT 1: LIGHTWEIGHT (Got-Scraping) ---
  if (!FORCE_PLAYWRIGHT) {
    try {
      if (ENABLE_DEBUG) console.log(`[METHOD] Attempting lightweight scrape (got-scraping)...`);
      const results = await scrapeWithGot(dateStr, latitude, longitude, sessionId);

    // [PARANOID CHECK]
    // If we got 0 results, we don't trust it. It might be a soft block or a Cloudflare challenge 
    // that we didn't catch. We force the fallback to be sure.
    if (results.length === 0) {
       console.warn(`[WARNING] Lightweight scrape found 0 artists. Assuming block/error. Falling back to Browser.`);
       throw new Error('Zero results from Got-Scraping');
    }

      if (ENABLE_DEBUG) console.log(`[SUCCESS] Lightweight scrape finished with ${results.length} artists.`);
      return results;

    } catch (error) {
      console.warn(`[WARNING] Lightweight scrape failed. Falling back to Browser. Reason: ${error.error}`);
      if (error.code) console.error('Error Code:', error.code);
      console.log(`[FALLBACK] Launching full browser (Playwright)...`);
    }
  } else {
      console.log('[DEBUG] Forcing Playwright Fallback...');
  }
    // --- ATTEMPT 2: HEAVYWEIGHT (Playwright) ---
    if (ENABLE_DEBUG) console.log(`[METHOD] Launching full browser (Playwright)...`);
    return await scrapeWithPlaywright(dateStr, latitude, longitude, sessionId);
  }

/**
 * METHOD A: Lightweight HTTP Request (Low RAM, High Speed)
 * Mimics browser TLS/Headers without launching Chromium.
 */
async function scrapeWithGot(dateStr, latitude, longitude, sessionId) {
  // Dynamic import because got-scraping is ESM
  const { gotScraping } = await import('got-scraping');
  // const { HttpsProxyAgent } = await import('hpagent');

  const formattedDate = formatDateForBandsintown(dateStr);
  const allArtistNames = [];
  let pageNum = 1;

  // Configure Proxy Agent
  const proxyUrl = `http://${PROXY_USER}-sessid-${sessionId}:${PROXY_PASS}@${PROXY_URL}:${PROXY_PORT}`;
  // const agent = {
  //   https: new HttpsProxyAgent({ proxy: proxyUrl })
  // };

  if (ENABLE_DEBUG) {
    try {
      console.log('[PROXY CHECK] Verifying IP address...');
      const ipCheck = await gotScraping({
        url: 'https://api.ipify.org?format=json',
        responseType: 'json',
        proxyUrl: proxyUrl,  // ← Use native proxyUrl instead of agent
        retry: { limit: 1 }
      });
      console.log(`[PROXY CHECK] Current Public IP: ${ipCheck.body.ip}`);
    } catch (err) {
      console.warn(`[PROXY CHECK] Failed to verify IP: ${err.message}`);
    }
  }

  while (true) {
    const apiUrl = `https://www.bandsintown.com/choose-dates/fetch-next/upcomingEvents?date=${formattedDate}&page=${pageNum}&longitude=${longitude}&latitude=${latitude}&genre_query=all-genres`;
    
    if (ENABLE_DEBUG) {
      const nodeMem = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(`[GOT] Fetching page ${pageNum}... | 🧠 RAM: ${nodeMem} MB`);
    }

    // Make the request
    const response = await gotScraping({
      url: apiUrl,
      method: 'GET',
      responseType: 'json',
      proxyUrl: proxyUrl,  // ← Use native proxyUrl instead of agent
      // // [FIX] Force HTTP/1.1 to ensure proxy tunneling works reliably with residential IPs
      // http2: false,
      retry: { limit: 2 }, // Auto-retry on network blips
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 110 }],
        devices: ['desktop'],
        locales: ['en-US'],
      }
    });

    const data = response.body;

    // [CLOUDFLARE CHECK]
    // Sometimes 'responseType: json' parses HTML successfully if it's weirdly formatted,
    // or we didn't catch the error. Explicitly check for strings that look like HTML.
    if (typeof data === 'string' && (data.includes('<!DOCTYPE html>') || data.includes('Cloudflare'))) {
        throw new Error('Cloudflare Blocked Request');
    }

    // DIAGNOSTIC LOGGING
    // If we find no events, print what we DID find before quitting.
    // if (!data.events || data.events.length === 0) {
    //   if (ENABLE_DEBUG) {
    //     console.warn(`[GOT WARNING] Page ${pageNum} returned 0 events.`);
    //     console.warn(`[GOT DIAGNOSTIC] Response Headers:`, response.headers);
    //     // Print the first 500 chars of the body to see if it's an error message
    //     console.warn(`[GOT DIAGNOSTIC] Body Preview: ${JSON.stringify(data).substring(0, 500)}`);
    //   }
    // }

    const events = data.events || [];

    if (events.length === 0) break;

    const artistsOnPage = events.map(event => event.artistName);
    allArtistNames.push(...artistsOnPage);

    if (!data.urlForNextPageOfEvents) break;

    pageNum++;
    await sleep(500); // Be polite
  }

  return allArtistNames;
}

/**
 * METHOD B: Full Browser (High RAM, High Reliability)
 * The fallback if lightweight scraping gets blocked.
 */
async function scrapeWithPlaywright(dateStr, latitude, longitude, sessionId) {
  const formattedDate = formatDateForBandsintown(dateStr);
  const allArtistNames = [];
  let pageNum = 1;
  let browser = null

  // --- 1. INITIALIZATION & LOGGING ---
  if (ENABLE_DEBUG) console.log(`[PROXY CONFIG] URL: ${PROXY_URL || 'MISSING'}, PORT: ${PROXY_PORT || 'MISSING'}, USER: ${PROXY_USER ? 'SET' : 'NOT SET'}`);

  try {
    // --- 2. PROXY SETUP ---
    let launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Aggressive Memory Saving Flags
        '--disable-gpu',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--mute-audio',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-breakpad',
        '--enable-low-end-device-mode',
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

    // --- ZOMBIE CLEANUP (Start) --- 
    // This catches Ctrl+C and closes the browser so it doesn't stay running in the background.
    const signalHandler = async () => {
      if (browser) {
        console.log('\n[SIGINT] Force closing browser to prevent zombie process...');
        await browser.close();
        process.exit();
      }
    };
    process.on('SIGINT', signalHandler);
    // --- ZOMBIE CLEANUP (End) ---

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    // [DEBUG] IP CHECK PLAYWRIGHT
    if (ENABLE_DEBUG) {
        console.log('[PLAYWRIGHT] Checking IP...');
        try {
            await page.goto('https://api.ipify.org?format=json');
            const ipContent = await page.evaluate(() => document.body.innerText);
            const ipJson = JSON.parse(ipContent);
            console.log(`[PLAYWRIGHT] Current Public IP: ${ipJson.ip}`);
        } catch (e) {
            console.warn(`[PLAYWRIGHT] Failed to check IP: ${e.message}`);
        }
    }

    // --- 3. PAGINATION LOOP ---
    // Using while(true) to handle multiple exit conditions explicitly
    while (true) {
      const apiUrl = `https://www.bandsintown.com/choose-dates/fetch-next/upcomingEvents?date=${formattedDate}&page=${pageNum}&longitude=${longitude}&latitude=${latitude}&genre_query=all-genres`;
      
      if (ENABLE_DEBUG) console.log(`[PLAYWRIGHT] Navigating to API page ${pageNum}...`);

      // Go to the URL and capture the response object
      const response = await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Memory Check
      if (ENABLE_DEBUG) {
        const browserMem = getBrowserMemory();
        const nodeMem = Math.round(process.memoryUsage().rss / 1024 / 1024);
        console.log(`[MEMORY] Page ${pageNum} | 🧠 Node: ${nodeMem} MB | 🎭 Browser: ${Math.round(browserMem)} MB`);
      }
      
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

      // --- SOFT BLOCK DETECTION (Start) ---
      // Sometimes they send a 200 OK but the page says "Pardon Our Interruption"
      if (pageContent.includes('Pardon Our Interruption') || pageContent.includes('human verification') || pageContent.includes('Access Denied')) {
        console.error(`\n🛑 SOFT BLOCK DETECTED (Page ${pageNum}). The IP ${sessionId} is burned.`);
        console.error(`   Response preview: ${pageContent.substring(0, 100)}`);
        break; 
      }
      // --- SOFT BLOCK DETECTION (End) ---

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
    console.error(`[PLAYWRIGHT ERROR] Scraper failed: ${error.message}`);
    // If Playwright fails, we return what we found so far rather than nothing
    return allArtistNames;
  } finally {
    if (browser) {
      if (ENABLE_DEBUG) console.log('[CLEANUP] Closing browser...');
      await browser.close();
    }
  }

  if (ENABLE_DEBUG) console.log(`[COMPLETE] Total artists found: ${allArtistNames.length}`);
  return allArtistNames;
}

function getBrowserMemory() {
  try {
    // 1. Use '[h]eadless_shell' to prevent grep from matching itself.
    // 2. Use 'rss=' to remove headers if you weren't already using -o (though your command is fine).
    // 3. We calculate the sum in KB first.
    const cmd = "ps -A -o rss,comm | grep [h]eadless_shell | awk '{ sum += $1 } END { print sum / 1024 }'";
    
    const output = execSync(cmd).toString().trim();
    
    // If output is empty (no processes found), return 0
    if (!output) return 0;

    const mb = parseFloat(output);
    return isNaN(mb) ? 0 : mb;
  } catch (error) {
    return 0; 
  }
}

module.exports = { scrapeBandsintown };
