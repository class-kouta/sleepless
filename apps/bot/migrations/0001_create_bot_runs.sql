CREATE TABLE bot_runs (
  window_end_at TEXT PRIMARY KEY,
  window_start_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'posted', 'skipped', 'failed')),
  x_post_id TEXT,
  error_code TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
