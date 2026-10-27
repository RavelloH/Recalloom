-- Keep current snapshots hot while version metadata remains cold.
CREATE TABLE record_histories (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
  history_metadata TEXT NOT NULL
);
INSERT INTO record_histories(record_id,history_metadata)
SELECT record_id,history_metadata FROM record_contents;
ALTER TABLE record_contents DROP COLUMN history_metadata;
