CREATE TABLE oauth_token_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL CHECK (status IN ('ready', 'refreshing', 'recovery_required')),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  refresh_ciphertext TEXT NOT NULL,
  access_ciphertext TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  error_code TEXT,
  updated_at INTEGER NOT NULL,
  CHECK ((status = 'refreshing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'refreshing' AND lease_owner IS NULL AND lease_expires_at IS NULL))
);

CREATE TABLE oauth_token_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  generation INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL
);
