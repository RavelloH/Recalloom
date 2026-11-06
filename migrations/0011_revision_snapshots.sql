-- Durable, independently verified content revisions. Do not mutate the old
-- text-version history metadata: some preexisting chains contain duplicate
-- version names and are too expensive or unsafe to append.
-- Store exact snapshots for future edits and preserve the current legacy head
-- when a record first transitions to this mechanism.
CREATE TABLE IF NOT EXISTS record_revision_snapshots (
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  PRIMARY KEY(record_id, revision),
  FOREIGN KEY(record_id, revision) REFERENCES revisions(record_id, revision) ON DELETE CASCADE
);
