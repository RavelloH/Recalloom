-- Semantic task activity is complete for commits made by the new application.
CREATE TABLE activity_coverage (
 id INTEGER PRIMARY KEY CHECK(id=1),
 started_at TEXT NOT NULL,
 started_seq INTEGER NOT NULL
);
INSERT INTO activity_coverage(id,started_at,started_seq)
 SELECT 1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),COALESCE(MAX(seq),0) FROM change_events;
CREATE INDEX change_events_created_seq ON change_events(created_at DESC,seq DESC);
