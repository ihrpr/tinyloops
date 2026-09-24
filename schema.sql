-- Tinyloops D1 schema.
--
-- Deliberately tiny: baby data lives in each user's own Google Sheet, never
-- here. D1 holds only who the user is, their encrypted Google tokens, and
-- which spreadsheet is theirs. Shared preferences (breastfeed_ml,
-- enabled_types) live in the sheet's Settings tab, not here, so everyone
-- sharing the sheet sees the same values.

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,   -- Google "sub", or "guest:<uuid>"
  email                TEXT NOT NULL,      -- '' for guests
  name                 TEXT,               -- guest display name ("added by" column)
  kind                 TEXT NOT NULL DEFAULT 'google', -- 'google' | 'guest'
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

-- Partner invites. An accepted invite is also the standing record that the
-- invitee reads/writes the sheet through the INVITER's Google credentials
-- (drive.file grants are per Google account, so the invitee's own token
-- can't touch the sheet without a Picker round; see requireSheet in
-- server/index.js).
CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,           -- random uuid
  inviter_id  TEXT NOT NULL REFERENCES users(id),
  email       TEXT NOT NULL,              -- invited address, lowercased
  sheet_id    TEXT NOT NULL,              -- inviter's sheet at invite time
  created_at  INTEGER NOT NULL,           -- unix ms
  accepted_by TEXT REFERENCES users(id),  -- NULL until accepted
  accepted_at INTEGER                     -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_accepted ON invites(accepted_by, sheet_id);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(inviter_id);

-- Single-use caregiver join links. Opening /join/<code> lets anyone join the
-- owner's tracker: with a Google session it attaches that account (same as
-- an accepted invite), without one it creates a 'guest' user who needs no
-- Google account at all. owner_id is always the CREDENTIAL HOLDER whose
-- token the joiner will proxy through (see requireSheet). guest_id marks a
-- re-link: the link signs an existing guest back in instead of creating one.
CREATE TABLE IF NOT EXISTS join_links (
  id         TEXT PRIMARY KEY,             -- sha256 of the link code
  owner_id   TEXT NOT NULL REFERENCES users(id),
  sheet_id   TEXT NOT NULL,
  guest_id   TEXT REFERENCES users(id),    -- NULL unless re-linking a guest
  created_at INTEGER NOT NULL,             -- unix ms
  expires_at INTEGER NOT NULL,
  used_at    INTEGER                       -- single-use: set when consumed
);

CREATE INDEX IF NOT EXISTS idx_join_links_owner ON join_links(owner_id);

-- Passkeys (WebAuthn credentials). The way a caregiver without a Google
-- account signs back in by themselves — a home-screen web app has its own
-- cookie jar, so the join-link session doesn't carry over, but passkeys are
-- OS-level. Google users may register them too.
CREATE TABLE IF NOT EXISTS passkeys (
  credential_id TEXT PRIMARY KEY,          -- base64url, as the browser reports it
  user_id       TEXT NOT NULL REFERENCES users(id),
  public_key    TEXT NOT NULL,             -- SPKI DER, base64
  alg           INTEGER NOT NULL,          -- COSE: -7 ES256 | -257 RS256
  counter       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL           -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
