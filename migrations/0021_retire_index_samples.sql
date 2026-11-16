-- Capacity and queue charts now aggregate current data on demand.
-- These disposable snapshots contain no source documents or execution history.
DROP TABLE IF EXISTS index_samples;
-- Drawer history reads should touch only this record's latest executions.
CREATE INDEX IF NOT EXISTS index_runs_record_time ON index_runs(record_id,created_at DESC);
