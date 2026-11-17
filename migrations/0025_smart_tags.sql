ALTER TABLE tags ADD COLUMN smart_enabled INTEGER NOT NULL DEFAULT 1 CHECK(smart_enabled IN (0,1));
ALTER TABLE tags ADD COLUMN propagate INTEGER NOT NULL DEFAULT 1 CHECK(propagate IN (0,1));
ALTER TABLE record_tags ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','auto'));
ALTER TABLE record_tags ADD COLUMN reason TEXT NOT NULL DEFAULT '';
ALTER TABLE record_tags ADD COLUMN evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE record_tags ADD COLUMN source_revision INTEGER;
ALTER TABLE record_tags ADD COLUMN generated_at TEXT;
CREATE TABLE smart_tag_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 model TEXT NOT NULL DEFAULT '@cf/google/gemma-4-26b-a4b-it',
 definition_version INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 1
);
INSERT INTO smart_tag_settings(id) VALUES(1);
CREATE TABLE record_tag_suppressions (
 record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(record_id,tag_id)
);
CREATE INDEX record_tag_suppressions_tag ON record_tag_suppressions(tag_id,record_id);
CREATE TABLE smart_tag_jobs (
 record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','retry','failed','done')),
 propagate INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 definition_version INTEGER NOT NULL DEFAULT 0,
 revision INTEGER,
 lease_token TEXT,
 lease_expires_at TEXT,
 next_retry_at TEXT,
 last_error TEXT,
 updated_at TEXT NOT NULL,
 finished_at TEXT
);
CREATE INDEX smart_tag_jobs_ready ON smart_tag_jobs(state,next_retry_at,updated_at);
CREATE TABLE smart_tag_evidence (
 record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 related_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 PRIMARY KEY(record_id,related_id)
);
CREATE INDEX smart_tag_evidence_related ON smart_tag_evidence(related_id,record_id);
CREATE TRIGGER smart_tag_definition_insert AFTER INSERT ON tags BEGIN
 UPDATE smart_tag_settings SET definition_version=definition_version+1 WHERE id=1;
END;
CREATE TRIGGER smart_tag_definition_update AFTER UPDATE OF name,description,smart_enabled,propagate,merged_into ON tags BEGIN
 UPDATE smart_tag_settings SET definition_version=definition_version+1 WHERE id=1;
END;
CREATE TRIGGER smart_tag_definition_delete AFTER DELETE ON tags BEGIN
 UPDATE smart_tag_settings SET definition_version=definition_version+1 WHERE id=1;
END;
CREATE TRIGGER smart_tag_alias_insert AFTER INSERT ON tag_names BEGIN UPDATE smart_tag_settings SET definition_version=definition_version+1 WHERE id=1; END;
CREATE TRIGGER smart_tag_alias_update AFTER UPDATE ON tag_names BEGIN UPDATE smart_tag_settings SET definition_version=definition_version+1 WHERE id=1; END;
CREATE TRIGGER smart_tag_alias_delete AFTER DELETE ON tag_names BEGIN UPDATE smart_tag_settings SET definition_version=definition_version+1 WHERE id=1; END;
CREATE TRIGGER smart_tag_index_ready AFTER UPDATE OF state ON index_jobs
WHEN NEW.state='done' AND NEW.indexed_revision=NEW.revision AND EXISTS(SELECT 1 FROM records r JOIN record_contents c ON c.record_id=r.id WHERE r.id=NEW.record_id AND r.status<>'archived' AND c.revision=NEW.indexed_revision)
BEGIN
 INSERT INTO smart_tag_jobs(record_id,propagate,updated_at) VALUES(NEW.record_id,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(record_id) DO UPDATE SET generation=generation+1,state=CASE WHEN state='running' THEN state ELSE 'pending' END,propagate=1,attempts=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;
CREATE TRIGGER smart_tag_manual_insert AFTER INSERT ON record_tags WHEN NEW.source='manual' BEGIN
 INSERT INTO smart_tag_jobs(record_id,propagate,updated_at) VALUES(NEW.record_id,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(record_id) DO UPDATE SET generation=generation+1,state=CASE WHEN state='running' THEN state ELSE 'pending' END,propagate=1,attempts=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;
CREATE TRIGGER smart_tag_manual_delete AFTER DELETE ON record_tags WHEN OLD.source='manual' AND EXISTS(SELECT 1 FROM records WHERE id=OLD.record_id AND status<>'archived') BEGIN
 INSERT INTO smart_tag_jobs(record_id,propagate,updated_at) VALUES(OLD.record_id,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(record_id) DO UPDATE SET generation=generation+1,state=CASE WHEN state='running' THEN state ELSE 'pending' END,propagate=1,attempts=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;
CREATE TRIGGER smart_tag_manual_update AFTER UPDATE OF source,tag_id ON record_tags WHEN NEW.source='manual' BEGIN
 INSERT INTO smart_tag_jobs(record_id,propagate,updated_at) VALUES(NEW.record_id,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(record_id) DO UPDATE SET generation=generation+1,state=CASE WHEN state='running' THEN state ELSE 'pending' END,propagate=1,attempts=0,next_retry_at=NULL,last_error=NULL,updated_at=excluded.updated_at;
END;
CREATE TRIGGER smart_tag_record_deleted BEFORE DELETE ON records BEGIN DELETE FROM smart_tag_jobs WHERE record_id=OLD.id; END;
CREATE TRIGGER smart_tag_archive AFTER UPDATE OF status ON records WHEN NEW.status='archived' BEGIN DELETE FROM smart_tag_jobs WHERE record_id=NEW.id; END;
