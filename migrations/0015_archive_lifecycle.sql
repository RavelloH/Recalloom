-- Archived records live outside the active directory tree.
-- Preserve old locations as non-foreign-key snapshots, allowing folder removal.
ALTER TABLE records ADD COLUMN archived_from_path TEXT;
ALTER TABLE records ADD COLUMN archived_from_folder_id TEXT;
ALTER TABLE records ADD COLUMN archived_at TEXT;
DROP INDEX records_siblings;
DROP INDEX records_root;
-- Remove legacy folder-name triggers before detaching archives: an archived
-- record may share its name with a root folder.
DROP TRIGGER folders_disallow_record_name_on_insert;
DROP TRIGGER folders_disallow_record_name_on_update;
DROP TRIGGER records_disallow_folder_name_on_insert;
DROP TRIGGER records_disallow_folder_name_on_update;
WITH RECURSIVE paths(id,path) AS (
  SELECT id,'/'||name FROM folders WHERE parent_id IS NULL
  UNION ALL
  SELECT f.id,p.path||'/'||f.name FROM folders f JOIN paths p ON p.id=f.parent_id
)
UPDATE records SET
 archived_from_path=COALESCE((SELECT path FROM paths WHERE id=folder_id),'')||'/'||name,
 archived_from_folder_id=folder_id,
 archived_at=updated_at,
 folder_id=NULL
WHERE status='archived';
CREATE UNIQUE INDEX records_siblings ON records(folder_id,name)
 WHERE folder_id IS NOT NULL AND status!='archived';
CREATE UNIQUE INDEX records_root ON records(name)
 WHERE folder_id IS NULL AND status!='archived';

-- Virtual names must only collide with ACTIVE records.
CREATE TRIGGER folders_disallow_record_name_on_insert
BEFORE INSERT ON folders
WHEN EXISTS (SELECT 1 FROM records WHERE folder_id IS NEW.parent_id AND name=NEW.name AND status!='archived')
BEGIN SELECT RAISE(ABORT,'PATH_CONFLICT'); END;
CREATE TRIGGER folders_disallow_record_name_on_update
BEFORE UPDATE OF parent_id,name ON folders
WHEN EXISTS (SELECT 1 FROM records WHERE folder_id IS NEW.parent_id AND name=NEW.name AND status!='archived')
BEGIN SELECT RAISE(ABORT,'PATH_CONFLICT'); END;
CREATE TRIGGER records_disallow_folder_name_on_insert
BEFORE INSERT ON records
WHEN NEW.status!='archived' AND EXISTS (SELECT 1 FROM folders WHERE parent_id IS NEW.folder_id AND name=NEW.name)
BEGIN SELECT RAISE(ABORT,'PATH_CONFLICT'); END;
CREATE TRIGGER records_disallow_folder_name_on_update
BEFORE UPDATE OF folder_id,name,status ON records
WHEN NEW.status!='archived' AND EXISTS (SELECT 1 FROM folders WHERE parent_id IS NEW.folder_id AND name=NEW.name)
BEGIN SELECT RAISE(ABORT,'PATH_CONFLICT'); END;

-- Durable external Vectorize cleanup outbox survives record CASCADE deletion.
CREATE TABLE vector_delete_jobs (
 record_id TEXT PRIMARY KEY,
 chunk_ids TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','failed')),
 started_at TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX vector_delete_jobs_queue ON vector_delete_jobs(state,created_at);
-- Transactional compare-and-set assertions for subtree operations.
CREATE TABLE lifecycle_guards(value INTEGER NOT NULL CHECK(value=1));
