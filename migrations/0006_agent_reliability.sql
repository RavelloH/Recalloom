-- Independent metadata revisions, durable index leases and structured change events.
ALTER TABLE records ADD COLUMN metadata_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE folders ADD COLUMN metadata_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE index_jobs ADD COLUMN started_at TEXT;
CREATE INDEX IF NOT EXISTS index_jobs_recovery ON index_jobs(state,started_at);
ALTER TABLE change_events ADD COLUMN entity_type TEXT;
ALTER TABLE change_events ADD COLUMN entity_id TEXT;
ALTER TABLE change_events ADD COLUMN details_json TEXT;
UPDATE change_events SET entity_type='record',entity_id=record_id
WHERE record_id IS NOT NULL AND entity_type IS NULL;
UPDATE change_events SET entity_type='folder',
 entity_id=substr(event_type,8,instr(substr(event_type,8),':')-1)
WHERE record_id IS NULL AND event_type LIKE 'folder:%:updated' AND entity_type IS NULL;
