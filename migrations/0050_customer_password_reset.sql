PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customer_password_reset_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  cooperative_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(account_id) REFERENCES customer_accounts(id),
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_password_reset_account
  ON customer_password_reset_tokens(account_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_customer_password_reset_token
  ON customer_password_reset_tokens(token_hash, used_at, expires_at);
