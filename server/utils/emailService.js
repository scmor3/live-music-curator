const { Resend } = require('resend');
const path = require('path');

// Only load .env file in local development (when DATABASE_URL is not set)
// In production (Railway), environment variables are set directly
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
}

// Initialize Resend client
const resendApiKey = process.env.RESEND_API_KEY;
if (!resendApiKey) {
  console.warn('⚠️  RESEND_API_KEY not found. Email functionality will be disabled.');
  console.warn('   Environment check - DATABASE_URL:', process.env.DATABASE_URL ? 'set' : 'not set');
  console.warn('   Available env vars with "RESEND":', Object.keys(process.env).filter(k => k.includes('RESEND')).join(', ') || 'none');
  console.warn('   Available env vars with "EMAIL":', Object.keys(process.env).filter(k => k.includes('EMAIL')).join(', ') || 'none');
}

const resend = resendApiKey ? new Resend(resendApiKey) : null;

// Email configuration
const FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@livemusiccurator.com';
const DONATION_LINK = process.env.DONATION_LINK || process.env.NEXT_PUBLIC_DONATE_URL || 'https://buy.stripe.com/your-payment-link-here';
const SUPPORT_EMAIL = 'livemusiccurator@gmail.com';

// Rate limiting: Resend allows 2 requests per second
// Track last send time to throttle requests
let lastEmailSendTime = 0;
const MIN_EMAIL_INTERVAL_MS = 500; // 500ms = 2 requests per second max

/**
 * Format hour for display (e.g., 19 -> "7pm", 0 -> "12am")
 */
function formatHourShort(hour) {
  if (hour === 0 || hour === 24) return '12am';
  if (hour === 12) return '12pm';
  return hour > 12 ? `${hour - 12}pm` : `${hour}am`;
}

/**
 * Format date for display (e.g., "2025-12-31" -> "Dec 31, 2025")
 * Parses the date string as a local date to avoid timezone issues
 */
function formatDatePretty(isoDate) {
  if (!isoDate) return '';
  // Parse date string (YYYY-MM-DD) as local date to avoid timezone conversion
  // This prevents off-by-one errors when the date is interpreted as UTC
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day); // month is 0-indexed in Date constructor
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

/**
 * Build email body text from playlist data
 */
function buildEmailBody(playlistData) {
  const {
    cityName,
    playlistDate,
    playlistId,
    artistCount = 0,
    excludedGenres = null,
    minStartTime = null,
    maxStartTime = null
  } = playlistData;

  const playlistUrl = `https://open.spotify.com/playlist/${playlistId}`;
  const formattedDate = formatDatePretty(playlistDate);

  let body = `Hi there!\n\n`;
  body += `Your playlist for ${cityName} on ${formattedDate} is ready!\n\n`;
  body += `Playlist Link: ${playlistUrl}\n\n`;
  body += `Details:\n`;
  body += `- City: ${cityName}\n`;
  body += `- Date: ${formattedDate}\n`;
  body += `- Artists: ${artistCount} artists\n`;

  // Add excluded genres if any
  if (excludedGenres && excludedGenres.length > 0) {
    const prettyGenres = excludedGenres.map(g => g.charAt(0).toUpperCase() + g.slice(1)).join(', ');
    body += `- Excluded Genres: ${prettyGenres}\n`;
  }

  // Add time range if filtered
  if (minStartTime !== null && minStartTime > 0) {
    body += `- Time Range: After ${formatHourShort(minStartTime)}`;
    if (maxStartTime !== null && maxStartTime < 24) {
      body += `, Before ${formatHourShort(maxStartTime)}`;
    }
    body += `\n`;
  } else if (maxStartTime !== null && maxStartTime < 24) {
    body += `- Time Range: Before ${formatHourShort(maxStartTime)}\n`;
  }

  body += `\nEnjoy discovering new music!\n\n`;
  body += `---\n`;
  body += `Visit us: https://livemusiccurator.com\n\n`;
  body += `Contact us at ${SUPPORT_EMAIL}\n\n`;
  body += `Support Live Music Curator\n`;
  body += `Donate: ${DONATION_LINK}\n\n`;
  body += `You're receiving this because you requested a playlist link from Live Music Curator.\n`;

  return body;
}

/**
 * Send email with playlist link
 * @param {Object} params - Email parameters
 * @param {string} params.to - Recipient email address
 * @param {string} params.playlistId - Spotify playlist ID
 * @param {string} params.cityName - City name
 * @param {string} params.playlistDate - Date in YYYY-MM-DD format
 * @param {number} params.artistCount - Number of artists in playlist
 * @param {string[]} params.excludedGenres - Array of excluded genres (optional)
 * @param {number} params.minStartTime - Minimum start time filter (optional)
 * @param {number} params.maxStartTime - Maximum start time filter (optional)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendPlaylistEmail({
  to,
  playlistId,
  cityName,
  playlistDate,
  artistCount = 0,
  excludedGenres = null,
  minStartTime = null,
  maxStartTime = null
}) {
  if (!resend) {
    return {
      success: false,
      error: 'Email service not configured. RESEND_API_KEY is missing.'
    };
  }

  if (!to || !playlistId || !cityName || !playlistDate) {
    return {
      success: false,
      error: 'Missing required email parameters'
    };
  }

  try {
    // Rate limiting: Ensure we don't exceed 2 requests per second
    // Resend allows 2 requests per second, so we need at least 500ms between sends
    const now = Date.now();
    const timeSinceLastSend = now - lastEmailSendTime;
    if (timeSinceLastSend < MIN_EMAIL_INTERVAL_MS) {
      const waitTime = MIN_EMAIL_INTERVAL_MS - timeSinceLastSend;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    // Update timestamp right before making the API call
    lastEmailSendTime = Date.now();

    const subject = `Your Curated Live Music Playlist: ${cityName} - ${formatDatePretty(playlistDate)}`;
    const body = buildEmailBody({
      cityName,
      playlistDate,
      playlistId,
      artistCount,
      excludedGenres,
      minStartTime,
      maxStartTime
    });

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: subject,
      text: body
    });

    if (error) {
      // Handle rate limit errors - retry after a delay
      if (error.message && error.message.includes('Too many requests')) {
        // Wait 1 second and retry once
        await new Promise(resolve => setTimeout(resolve, 1000));
        lastEmailSendTime = Date.now();
        
        const retryResult = await resend.emails.send({
          from: FROM_EMAIL,
          to: [to],
          subject: subject,
          text: body
        });
        
        if (retryResult.error) {
          return {
            success: false,
            error: retryResult.error.message || 'Failed to send email after retry'
          };
        }
        // Retry succeeded, continue with retryResult
        return {
          success: true,
          messageId: retryResult.data?.id
        };
      }
      
      return {
        success: false,
        error: error.message || 'Failed to send email'
      };
    }

    return {
      success: true,
      messageId: data?.id
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Unexpected error sending email'
    };
  }
}

module.exports = {
  sendPlaylistEmail
};
