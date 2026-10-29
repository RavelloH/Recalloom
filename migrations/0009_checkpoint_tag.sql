-- Migrate historical checkpoint records to ordinary documents with a checkpoint tag.
-- Content, text-version history, revision hashes, stable IDs and updated_at are not changed.
INSERT INTO tags(id,name)
SELECT lower(hex(randomblob(16))),'checkpoint'
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE name='checkpoint');

INSERT OR IGNORE INTO record_tags(record_id,tag_id)
SELECT r.id,t.id FROM records r JOIN tags t ON t.name='checkpoint' WHERE r.kind='checkpoint';

INSERT INTO change_events(record_id,event_type,revision,actor,created_at,entity_type,entity_id,details_json)
SELECT id,'kind_migrate',NULL,'system:migration',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       'record',id,'{"from":"checkpoint","to":"document","tag":"checkpoint"}'
FROM records WHERE kind='checkpoint';

UPDATE records SET kind='document',metadata_revision=metadata_revision+1 WHERE kind='checkpoint';

-- Existing D1 databases retain the historical CHECK constraint: enforce the new API-level type set.
CREATE TRIGGER records_reject_checkpoint_insert BEFORE INSERT ON records
WHEN NEW.kind='checkpoint' BEGIN SELECT RAISE(ABORT,'LEGACY_KIND_NOT_SUPPORTED'); END;
CREATE TRIGGER records_reject_checkpoint_update BEFORE UPDATE OF kind ON records
WHEN NEW.kind='checkpoint' BEGIN SELECT RAISE(ABORT,'LEGACY_KIND_NOT_SUPPORTED'); END;
