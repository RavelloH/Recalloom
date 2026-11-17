ALTER TABLE smart_tag_jobs ADD COLUMN analyze INTEGER NOT NULL DEFAULT 1 CHECK(analyze IN (0,1));
ALTER TABLE smart_tag_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
UPDATE smart_tag_jobs SET analyze=0 WHERE state='done';

DROP TRIGGER smart_tag_manual_insert;
DROP TRIGGER smart_tag_manual_delete;
DROP TRIGGER smart_tag_manual_update;
DROP TRIGGER smart_tag_index_ready;

CREATE TRIGGER smart_tag_index_ready AFTER UPDATE OF state ON index_jobs
WHEN NEW.state='done' AND NEW.indexed_revision=NEW.revision AND EXISTS(SELECT 1 FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.id=NEW.record_id AND r.status<>'archived' AND c.revision=NEW.indexed_revision)
BEGIN
 INSERT INTO smart_tag_jobs(record_id,analyze,propagate,updated_at) VALUES(NEW.record_id,1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(record_id) DO UPDATE SET generation=generation+1,analyze=1,state=CASE WHEN state='running' THEN state ELSE 'pending' END,propagate=1,attempts=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;

CREATE TRIGGER smart_tag_manual_insert AFTER INSERT ON record_tags WHEN NEW.source='manual' BEGIN
 INSERT INTO smart_tag_jobs(record_id,analyze,priority,propagate,updated_at) VALUES(NEW.record_id,0,2,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(record_id) DO UPDATE SET generation=generation+1,analyze=CASE WHEN state='done' THEN 0 ELSE analyze END,state=CASE WHEN state='running' THEN state ELSE 'pending' END,priority=2,propagate=1,attempts=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;
CREATE TRIGGER smart_tag_manual_delete AFTER DELETE ON record_tags WHEN OLD.source='manual' AND EXISTS(SELECT 1 FROM records WHERE id=OLD.record_id AND status<>'archived') BEGIN
 INSERT INTO smart_tag_jobs(record_id,analyze,priority,propagate,updated_at) VALUES(OLD.record_id,0,2,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(record_id) DO UPDATE SET generation=generation+1,analyze=CASE WHEN state='done' THEN 0 ELSE analyze END,state=CASE WHEN state='running' THEN state ELSE 'pending' END,priority=2,propagate=1,attempts=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;
CREATE TRIGGER smart_tag_manual_update AFTER UPDATE OF source,tag_id ON record_tags WHEN NEW.source='manual' BEGIN
 INSERT INTO smart_tag_jobs(record_id,analyze,priority,propagate,updated_at) VALUES(NEW.record_id,0,2,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(record_id) DO UPDATE SET generation=generation+1,analyze=CASE WHEN state='done' THEN 0 ELSE analyze END,state=CASE WHEN state='running' THEN state ELSE 'pending' END,priority=2,propagate=1,attempts=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;
