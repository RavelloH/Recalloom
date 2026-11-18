CREATE TABLE smart_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX smart_collections_recent ON smart_collections(updated_at DESC, id);
