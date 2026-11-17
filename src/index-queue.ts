/** Append inside the same D1 transaction as the content/metadata write.
 * Explicit UPSERT also processes every row of bulk archive/restore statements. */
export const INDEX_JOB_UPSERT=` ON CONFLICT(record_id) DO UPDATE SET
 revision=excluded.revision,generation=index_jobs.generation+1,
 state=CASE WHEN index_jobs.state='running' THEN 'running' ELSE 'pending' END,
 stage=CASE WHEN index_jobs.state='running' THEN index_jobs.stage ELSE 'queued' END,
 vector_generation=NULL,
 completed_chunks=CASE WHEN index_jobs.state='running' THEN index_jobs.completed_chunks ELSE 0 END,
 total_chunks=CASE WHEN index_jobs.state='running' THEN index_jobs.total_chunks ELSE 0 END,
 attempts=0,
 next_retry_at=NULL,last_error=NULL,updated_at=excluded.created_at,finished_at=NULL`;
