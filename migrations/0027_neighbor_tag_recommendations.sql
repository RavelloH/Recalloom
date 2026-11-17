-- Event-driven Clef classification: only the vector index retains a job state.
-- Keep existing automatic associations; they will be reconciled on subsequent edits.
DROP TRIGGER IF EXISTS smart_tag_index_ready;
DROP TRIGGER IF EXISTS smart_tag_manual_insert;
DROP TRIGGER IF EXISTS smart_tag_manual_delete;
DROP TRIGGER IF EXISTS smart_tag_manual_update;
DROP TRIGGER IF EXISTS smart_tag_archive;
DROP TRIGGER IF EXISTS smart_tag_record_deleted;
DROP TRIGGER IF EXISTS smart_tag_definition_insert;
DROP TRIGGER IF EXISTS smart_tag_definition_update;
DROP TRIGGER IF EXISTS smart_tag_definition_delete;
DROP TRIGGER IF EXISTS smart_tag_alias_insert;
DROP TRIGGER IF EXISTS smart_tag_alias_update;
DROP TRIGGER IF EXISTS smart_tag_alias_delete;

ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'smart'
  CHECK(kind IN ('smart','fixed'));
UPDATE tags SET kind='fixed' WHERE smart_enabled=0 OR propagate=0;
DELETE FROM record_tags WHERE source='auto' AND tag_id IN
  (SELECT id FROM tags WHERE kind='fixed');
ALTER TABLE tags DROP COLUMN smart_enabled;
ALTER TABLE tags DROP COLUMN propagate;

ALTER TABLE record_tags ADD COLUMN confidence REAL
  CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1));

-- Record the exact index generation whose vectors have been uploaded.
-- This distinguishes a content revision from a title-only reindex.
ALTER TABLE index_jobs ADD COLUMN vector_generation INTEGER;

DROP TABLE smart_tag_jobs;
DROP TABLE smart_tag_settings;

-- Enforce fixed-label semantics even for imports or raw SQL writers.
CREATE TRIGGER fixed_tag_no_auto_insert BEFORE INSERT ON record_tags
WHEN NEW.source='auto' AND EXISTS(
  SELECT 1 FROM tags WHERE id=NEW.tag_id AND kind='fixed')
BEGIN SELECT RAISE(ABORT,'FIXED_TAG_AUTOMATIC_FORBIDDEN'); END;
CREATE TRIGGER fixed_tag_no_auto_update BEFORE UPDATE OF source,tag_id ON record_tags
WHEN NEW.source='auto' AND EXISTS(
  SELECT 1 FROM tags WHERE id=NEW.tag_id AND kind='fixed')
BEGIN SELECT RAISE(ABORT,'FIXED_TAG_AUTOMATIC_FORBIDDEN'); END;
CREATE TRIGGER fixed_tag_cleanup AFTER UPDATE OF kind ON tags
WHEN NEW.kind='fixed'
BEGIN
  DELETE FROM record_tags WHERE tag_id=NEW.id AND source='auto';
END;
