PRAGMA foreign_keys = ON;
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name)>0 AND instr(name,'/')=0),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX folders_siblings ON folders(parent_id,name) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX folders_root ON folders(name) WHERE parent_id IS NULL;

CREATE TABLE records (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name)>0 AND instr(name,'/')=0),
  kind TEXT NOT NULL CHECK(kind IN ('document','task_list','checkpoint')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','completed','superseded','archived')),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX records_siblings ON records(folder_id,name) WHERE folder_id IS NOT NULL;
CREATE UNIQUE INDEX records_root ON records(name) WHERE folder_id IS NULL;
CREATE INDEX records_by_folder ON records(folder_id,status,updated_at);

CREATE TABLE record_contents (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  history_metadata TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=1),
  content_sha256 TEXT NOT NULL
);
CREATE TABLE revisions (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(record_id, revision)
);
CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE record_tags (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (record_id,tag_id)
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('todo','in_progress','blocked','done','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX tasks_record ON tasks(record_id,position);
CREATE INDEX tasks_status ON tasks(status,record_id);
CREATE TABLE record_links (
  source_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  PRIMARY KEY(source_id,target_id,relation)
);
CREATE TABLE change_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT,
  event_type TEXT NOT NULL,
  revision INTEGER,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE search_chunks (
  chunk_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  UNIQUE(record_id,revision,chunk_index)
);
CREATE TABLE index_jobs (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(record_id,revision)
);
CREATE INDEX index_jobs_queue ON index_jobs(state,created_at);

-- Fail-fast when a previously read version has changed, so batch() can roll back.
CREATE TRIGGER revision_must_advance
BEFORE UPDATE OF revision ON record_contents
WHEN NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'INVALID_REVISION_STEP');
END;
