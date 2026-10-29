-- Remember the display name from the OAuth consent that created each actor ID.
-- No passwords, tokens, or client secrets are stored here.
CREATE TABLE IF NOT EXISTS oauth_actor_names (
  actor_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
