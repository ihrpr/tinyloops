#!/usr/bin/env sh
# Registration stats from the tinyloops D1 database. Read-only SELECTs.
#
#   npm run stats            production numbers (needs `wrangler login`)
#   npm run stats -- --local the local dev database instead
#
# "Registered" = a row in users (created on first Google sign-in).
# "Set up" = they finished onboarding and connected a sheet.
set -e
cd "$(dirname "$0")/.."

TARGET=--remote
[ "$1" = "--local" ] && TARGET=--local

# D1 caps compound SELECTs well below stock SQLite — keep each union ≤ 3 terms.
npx wrangler d1 execute tinyloops "$TARGET" --command "
SELECT 'registered users' AS registration, COUNT(*) AS n FROM users
UNION ALL SELECT 'set up (sheet connected)', COUNT(*) FROM users WHERE sheet_id IS NOT NULL
UNION ALL SELECT 'partners joined via invite', COUNT(*) FROM invites WHERE accepted_by IS NOT NULL;

SELECT 'joined last 7 days' AS activity, COUNT(*) AS n FROM users
  WHERE created_at > (strftime('%s','now') - 7*86400) * 1000
UNION ALL SELECT 'joined last 30 days', COUNT(*) FROM users
  WHERE created_at > (strftime('%s','now') - 30*86400) * 1000
UNION ALL SELECT 'active last 7 days', COUNT(DISTINCT user_id) FROM sessions
  WHERE last_seen > (strftime('%s','now') - 7*86400) * 1000;

SELECT strftime('%Y-%m', created_at/1000, 'unixepoch') AS month,
       COUNT(*) AS signups
FROM users GROUP BY month ORDER BY month;
"
