-- Preserve original text-version history metadata before fixing chains corrupted
-- by pre-2.2.0 snapshot substitution. This table is deliberately append-only:
-- old reconstructed historical versions are not trustworthy without SHA checks.
CREATE TABLE IF NOT EXISTS record_history_quarantine (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
  original_metadata TEXT NOT NULL,
  original_revision INTEGER NOT NULL CHECK(original_revision >= 1),
  original_content_sha256 TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT NOT NULL
);
