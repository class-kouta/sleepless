CREATE TABLE sleepless_counts (
  window_end_at TEXT PRIMARY KEY,
  window_start_at TEXT NOT NULL,
  query_version TEXT NOT NULL,
  query_text TEXT NOT NULL,
  post_count INTEGER NOT NULL CHECK (post_count >= 0),
  fetched_at TEXT NOT NULL,
  x_post_id TEXT
);
