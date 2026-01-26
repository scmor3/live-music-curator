## Live Music Curator | Full-Stack Web Application (2025 - Present)

- Built location-based Spotify playlist generator using Next.js (React/TypeScript), Node.js, Express.js, and PostgreSQL that aggregates live music events and creates playlists via Spotify API
- Architected asynchronous job queue system with 4 concurrent worker threads using PostgreSQL job locking (`FOR UPDATE SKIP LOCKED`) to handle API rate-limiting and heavy web scraping jobs without blocking the main UI thread
- Implemented intelligent web scraping pipeline with dual-strategy approach: lightweight HTTP requests (got-scraping) with automatic fallback to Playwright browser automation when encountering Cloudflare protection, ensuring comprehensive data collection
- Designed optimized PostgreSQL schema with PostGIS for geospatial city lookups and pg_trgm for fuzzy text search, enabling fast city autocomplete with typo tolerance using GIST and GIN indexes
- Developed robust artist matching algorithm using Levenshtein distance fuzzy matching to handle misspellings, with duplicate detection and genre filtering with synonym expansion
- Implemented real-time progress tracking using PostgreSQL JSONB arrays for live activity feeds and comprehensive error handling with exponential backoff retries for API rate limits
- Integrated Supabase authentication supporting anonymous and authenticated users, with JWT token verification for protected API endpoints
- Deployed production application on Vercel (frontend) with automatic GitHub deployments
