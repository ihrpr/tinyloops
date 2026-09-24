-- Caregiver join links: run once against the EXISTING production D1
-- (schema.sql already includes all of this for fresh installs).
--
--   npx wrangler d1 execute tinyloops --remote --file migrations/2026-09-caregivers.sql
--
-- (add --local to update the local dev database instead)

ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'google';

CREATE TABLE IF NOT EXISTS join_links (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  sheet_id   TEXT NOT NULL,
  guest_id   TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_join_links_owner ON join_links(owner_id);

CREATE TABLE IF NOT EXISTS passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  public_key    TEXT NOT NULL,
  alg           INTEGER NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
