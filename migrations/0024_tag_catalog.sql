CREATE TABLE tag_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'gray',
  metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK(metadata_revision>=1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  merged_into TEXT REFERENCES tag_definitions(id) ON DELETE CASCADE
);
INSERT INTO tag_definitions(id,name,normalized_name) SELECT id,name,name FROM tags;
CREATE TABLE record_tag_links (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tag_definitions(id) ON DELETE CASCADE,
  PRIMARY KEY(record_id,tag_id)
);
INSERT INTO record_tag_links SELECT record_id,tag_id FROM record_tags;
DROP TABLE record_tags;
DROP TABLE tags;
ALTER TABLE tag_definitions RENAME TO tags;
ALTER TABLE record_tag_links RENAME TO record_tags;
CREATE UNIQUE INDEX tags_canonical_key ON tags(normalized_name) WHERE merged_into IS NULL;
CREATE INDEX record_tags_by_tag ON record_tags(tag_id,record_id);
CREATE TABLE tag_names (
  normalized_name TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE
);
INSERT INTO tag_names(normalized_name,name,tag_id) SELECT name,name,id FROM tags;
CREATE INDEX tag_names_by_tag ON tag_names(tag_id);
CREATE TABLE tag_catalog_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  version INTEGER NOT NULL DEFAULT 1,
  normalized INTEGER NOT NULL DEFAULT 0
);
INSERT INTO tag_catalog_state(id) VALUES(1);
CREATE TABLE tag_write_guard (id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TRIGGER tag_definition_insert AFTER INSERT ON tags BEGIN UPDATE tag_catalog_state SET version=version+1 WHERE id=1; END;
CREATE TRIGGER tag_definition_update AFTER UPDATE ON tags BEGIN UPDATE tag_catalog_state SET version=version+1 WHERE id=1; END;
CREATE TRIGGER tag_definition_delete AFTER DELETE ON tags BEGIN UPDATE tag_catalog_state SET version=version+1 WHERE id=1; END;
CREATE TRIGGER tag_name_insert AFTER INSERT ON tag_names BEGIN UPDATE tag_catalog_state SET version=version+1 WHERE id=1; END;
CREATE TRIGGER tag_name_update AFTER UPDATE ON tag_names BEGIN UPDATE tag_catalog_state SET version=version+1 WHERE id=1; END;
CREATE TRIGGER tag_name_delete AFTER DELETE ON tag_names BEGIN UPDATE tag_catalog_state SET version=version+1 WHERE id=1; END;
CREATE TRIGGER record_tag_insert AFTER INSERT ON record_tags BEGIN UPDATE tag_catalog_state SET version=version+1 WHERE id=1; END;
CREATE TRIGGER record_tag_delete AFTER DELETE ON record_tags BEGIN UPDATE tag_catalog_state SET version=version+1 WHERE id=1; END;
CREATE TRIGGER tag_record_visibility AFTER UPDATE OF status ON records WHEN (OLD.status='archived')<>(NEW.status='archived') BEGIN UPDATE tag_catalog_state SET version=version+1 WHERE id=1; END;
