-- One row per (person who texts the bot, friend whose birthday they saved).
CREATE TABLE IF NOT EXISTS birthdays (
  phone          TEXT    NOT NULL, -- the user's number, E.164
  name           TEXT    NOT NULL, -- as typed, e.g. "Varun"
  name_key       TEXT    NOT NULL, -- lowercased name, for matching
  month          INTEGER NOT NULL, -- 1-12
  day            INTEGER NOT NULL, -- 1-31
  last_sent_year INTEGER,          -- year the last reminder went out
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (phone, name_key)
);

CREATE INDEX IF NOT EXISTS birthdays_by_date ON birthdays (month, day);
