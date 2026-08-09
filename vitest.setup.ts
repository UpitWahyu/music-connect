/**
 * Vitest isolation: point ALL tests at a dedicated Redis database (db 9)
 * BEFORE any server module is imported. The queue test suite calls
 * redis.flushdb() to isolate itself — against the production database that
 * would wipe user state (selected device, volume, playback). This file runs
 * before test files (setupFiles), and dotenv never overrides an env var that
 * is already set, so the rest of the app picks this URL up.
 */
process.env.REDIS_URL = "redis://localhost:6379/9";
