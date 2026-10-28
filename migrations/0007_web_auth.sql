-- Browser administration sessions and single-use Cap.js PoW proofs.
-- No raw session tokens, administrator secrets, or challenge answers are stored.
CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent_hint TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS web_sessions_active ON web_sessions(expires_at,revoked_at);
CREATE TABLE IF NOT EXISTS web_nonces (
  id_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS web_nonces_expiry ON web_nonces(expires_at);
CREATE TABLE IF NOT EXISTS web_rate_limits (
  bucket_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS web_rate_limits_expiry ON web_rate_limits(expires_at);
