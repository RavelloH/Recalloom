-- Auto-extracted Markdown references are a derived projection of authoritative
-- content. They are deliberately separate from manual record_links.
-- Persistent identity pinning for path syntax. Keep UUID tombstones even if a
-- target is later permanently removed; never retarget an old path to a new ID.
CREATE TABLE IF NOT EXISTS record_path_bindings (
 source_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 target_expression TEXT NOT NULL CHECK(substr(target_expression,1,1)='/'),
 target_id TEXT NOT NULL,
 PRIMARY KEY(source_id,target_expression)
);
CREATE INDEX IF NOT EXISTS record_path_bindings_target ON record_path_bindings(target_id);

CREATE TABLE IF NOT EXISTS record_references (
 source_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 source_offset INTEGER NOT NULL CHECK(source_offset>=0),
 source_revision INTEGER NOT NULL CHECK(source_revision>=1),
 kind TEXT NOT NULL CHECK(kind IN ('link','embed')),
 target_expression TEXT NOT NULL,
 target_id TEXT REFERENCES records(id) ON DELETE SET NULL,
 anchor TEXT,
 alias TEXT,
 resolution_status TEXT NOT NULL CHECK(resolution_status IN ('resolved','missing')),
 PRIMARY KEY(source_id,source_offset,kind)
);
CREATE INDEX IF NOT EXISTS record_references_target ON record_references(target_id,kind,source_id);
CREATE INDEX IF NOT EXISTS record_references_source ON record_references(source_id,kind,source_offset);
