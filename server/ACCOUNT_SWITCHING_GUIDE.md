# Account Switching Guide

This guide explains how to switch between your primary and backup Spotify master accounts.

## Overview

The system now supports two Spotify master accounts:
- **Primary Account** (default)
- **Backup Account** (optional)

Each account maintains its own:
- Rate limit state in the database
- Access token cache
- Credentials

## Environment Variables

Add these to your `server/.env` file:

```env
# Primary Account (required)
MASTER_REFRESH_TOKEN=your_primary_refresh_token
MASTER_SPOTIFY_ID=your_primary_user_id

# Backup Account (optional, only needed if you want to use it)
MASTER_REFRESH_TOKEN_BACKUP=your_backup_refresh_token
MASTER_SPOTIFY_ID_BACKUP=your_backup_user_id

# Account Selection (set to true/1 to use backup, false/0 or unset to use primary)
USE_BACKUP_ACCOUNT=false
```

## How to Switch Accounts

### Option 1: Environment Variable (Recommended)

Set `USE_BACKUP_ACCOUNT` in your `.env` file:

```env
# Use primary account (default)
USE_BACKUP_ACCOUNT=false

# OR use backup account
USE_BACKUP_ACCOUNT=true
```

Then restart your server.

### Option 2: Command Line

You can also set it when starting the server:

```bash
# Use primary account
USE_BACKUP_ACCOUNT=false node index.js

# Use backup account
USE_BACKUP_ACCOUNT=true node index.js
```

## Database Migration

Before using account switching, run the migration to update the rate limit table:

```bash
cd server
node migrate.js
```

This will:
- Add `account_type` column to `rate_limit_state` table
- Support separate rate limit state for each account (type 1 = primary, type 2 = backup)

## How It Works

1. **Account Selection**: On server startup, the code checks `USE_BACKUP_ACCOUNT` and selects the appropriate credentials.

2. **Rate Limit State**: Each account maintains its own rate limit state in the database:
   - Primary account: `account_type = 1`
   - Backup account: `account_type = 2`

3. **Token Caching**: Access tokens are cached per account. If you switch accounts, the cache is cleared and a new token is fetched for the new account.

4. **Logging**: All logs include `[PRIMARY]` or `[BACKUP]` tags to indicate which account is being used.

## Example Log Output

When using primary account:
```
[ACCOUNT] Using PRIMARY Spotify account (ID: abc123...)
[TOKEN-REFRESH] [PRIMARY] Successfully refreshed master access token...
[RATE-LIMIT] [PRIMARY] Global rate limit set...
```

When using backup account:
```
[ACCOUNT] Using BACKUP Spotify account (ID: xyz789...)
[TOKEN-REFRESH] [BACKUP] Successfully refreshed master access token...
[RATE-LIMIT] [BACKUP] Global rate limit set...
```

## Use Cases

### Development Testing
Switch to backup account when primary account is rate-limited:
```env
USE_BACKUP_ACCOUNT=true
```

### Production Failover
If primary account hits rate limits, switch to backup:
```env
USE_BACKUP_ACCOUNT=true
```

### Rate Limit Isolation
Each account has separate rate limits, so you can:
- Use primary account for production
- Use backup account for testing/development
- Switch between them without affecting the other's rate limit state

## Important Notes

1. **Server Restart Required**: You must restart the server after changing `USE_BACKUP_ACCOUNT`.

2. **Missing Credentials**: If `USE_BACKUP_ACCOUNT=true` but backup credentials are missing, the server will log a warning but may fail when trying to use Spotify API.

3. **Rate Limit Persistence**: Rate limit state persists across server restarts. If you switch accounts, you'll load that account's rate limit state.

4. **Token Cache**: The token cache is cleared when switching accounts to ensure you get a fresh token for the new account.

## Troubleshooting

### "Missing backup credentials" warning
- Make sure `MASTER_REFRESH_TOKEN_BACKUP` and `MASTER_SPOTIFY_ID_BACKUP` are set in `.env`
- Use the `getSpotifyTokens.js` script to get backup account credentials

### Rate limit still active after switching
- Each account has its own rate limit state
- If backup account was rate-limited before, it will still be rate-limited
- Check the logs to see which account's rate limit is active

### Token refresh fails
- Verify the refresh token is correct for the selected account
- Check that the account hasn't revoked access at https://www.spotify.com/account/apps/
