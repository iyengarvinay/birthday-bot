-- One row per person who has texted the bot. name stays NULL until they
-- tell the bot what to call them.
CREATE TABLE IF NOT EXISTS users (
  phone      TEXT PRIMARY KEY, -- E.164
  name       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
