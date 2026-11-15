-- One durable, coalescing task per record. Preserve known completed submissions;
-- missing/stale/interrupted work is queued without claiming remote visibility.
DROP INDEX IF EXISTS index_jobs_queue;
ALTER TABLE index_jobs RENAME TO index_jobs_legacy;
CREATE TABLE index_jobs (
 id TEXT PRIMARY KEY,
 record_id TEXT NOT NULL UNIQUE REFERENCES records(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 indexed_revision INTEGER,
 generation INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','retry','failed','done')),
 stage TEXT NOT NULL DEFAULT 'queued',
 completed_chunks INTEGER NOT NULL DEFAULT 0,
 total_chunks INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,
 lease_expires_at TEXT,
 started_at TEXT,
 next_retry_at TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT,
 finished_at TEXT
);
INSERT INTO index_jobs(id,record_id,revision,indexed_revision,state,stage,created_at,updated_at)
 WITH heads AS (
  SELECT r.id,c.revision,r.status,r.updated_at,
   (SELECT MAX(s.revision) FROM search_chunks s WHERE s.record_id=r.id) AS indexed_revision,
   (SELECT j.state FROM index_jobs_legacy j WHERE j.record_id=r.id AND j.revision=c.revision ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1) AS previous_state
  FROM records r JOIN record_contents c ON c.record_id=r.id
 )
 SELECT id,id,revision,indexed_revision,
  CASE WHEN previous_state='done' AND (status='archived' OR indexed_revision=revision) THEN 'done' ELSE 'pending' END,
  CASE WHEN previous_state='done' AND (status='archived' OR indexed_revision=revision) THEN 'submitted' ELSE 'queued' END,
  updated_at,updated_at FROM heads;
DROP TABLE index_jobs_legacy;
CREATE INDEX index_jobs_queue ON index_jobs(state,next_retry_at,created_at);
CREATE TABLE index_runs (
 id TEXT PRIMARY KEY,record_id TEXT NOT NULL,revision INTEGER NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('done','failed','superseded')),
 chunks INTEGER NOT NULL,duration_ms INTEGER NOT NULL,created_at TEXT NOT NULL,error TEXT
);
CREATE INDEX index_runs_time ON index_runs(created_at);
CREATE TABLE index_samples (
 hour TEXT PRIMARY KEY,pending INTEGER NOT NULL,running INTEGER NOT NULL,failed INTEGER NOT NULL,
 documents INTEGER NOT NULL,chunks INTEGER NOT NULL,text_bytes INTEGER NOT NULL,
 vector_count INTEGER,database_bytes INTEGER,sampled_at TEXT NOT NULL
);
CREATE TABLE index_vector_garbage (
 id TEXT PRIMARY KEY,chunk_ids TEXT NOT NULL,not_before TEXT NOT NULL,last_error TEXT
);
