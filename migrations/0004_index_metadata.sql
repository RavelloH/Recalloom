-- Allow multiple indexing requests for a single content revision.
-- Metadata (name/status) can change without increasing the content revision.
CREATE TABLE index_jobs_rebuilt (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO index_jobs_rebuilt(id,record_id,revision,state,attempts,last_error,created_at)
SELECT id,record_id,revision,state,attempts,last_error,created_at FROM index_jobs;
DROP TABLE index_jobs;
ALTER TABLE index_jobs_rebuilt RENAME TO index_jobs;
CREATE INDEX index_jobs_queue ON index_jobs(state,created_at);

-- Existing archived records might still have embeddings from earlier releases.
-- Queue a cleanup pass; processIndexJobs removes recorded Vectorize chunks.
INSERT INTO index_jobs(id,record_id,revision,created_at)
SELECT lower(hex(randomblob(16))),r.id,c.revision,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM records r
JOIN record_contents c ON c.record_id=r.id
WHERE r.status='archived';
