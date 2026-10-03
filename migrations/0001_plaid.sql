CREATE TABLE connections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '',
  last_sync TEXT, error TEXT
);
CREATE TABLE accounts (id TEXT PRIMARY KEY, item TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE transactions (
  id TEXT PRIMARY KEY, account TEXT NOT NULL, date TEXT NOT NULL,
  body TEXT NOT NULL, pending INTEGER NOT NULL, removed INTEGER NOT NULL DEFAULT 0,
  evidence_key TEXT NOT NULL DEFAULT '', classification TEXT, correction TEXT
);
CREATE INDEX transactions_account ON transactions(account);
CREATE INDEX transactions_date ON transactions(date DESC);
CREATE TABLE model_cache (key TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE sync_lock (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
