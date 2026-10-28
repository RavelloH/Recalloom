-- Rebuild active document vectors with paragraph-aware chunk boundaries.
-- Archived records remain excluded; activating an archived record already queues its own rebuild.
INSERT INTO index_jobs (id,record_id,revision,created_at)
SELECT lower(hex(randomblob(16))),r.id,c.revision,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM records r
JOIN record_contents c ON c.record_id=r.id
WHERE r.status != 'archived';
