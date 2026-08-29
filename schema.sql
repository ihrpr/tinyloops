-- Tinyloops D1 schema.
--
-- Deliberately tiny: baby data lives in each user's own Google Sheet, never
-- here. D1 holds only who the user is, their encrypted Google tokens, and
-- which spreadsheet is theirs. Shared preferences (breastfeed_ml,
-- enabled_types) live in the sheet's Settings tab, not here, so everyone
-- sharing the sheet sees the same values.

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,   -- Google account id (OIDC "sub")
  email                TEXT NOT NULL,
  refresh_token_enc    TEXT,               -- AES-GCM, key = TOKEN_ENC_KEY
  access_token_enc     TEXT,               -- short-lived, cached between requests
  access_token_expires INTEGER,            -- unix ms
  sheet_id             TEXT,
  created_at           INTEGER NOT NULL    -- unix ms
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,             -- sha256 of the cookie value
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,             -- unix ms
  last_seen  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL              -- rolling ~90 days
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
-- for the opportunistic expired-session sweep in requireSession
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
