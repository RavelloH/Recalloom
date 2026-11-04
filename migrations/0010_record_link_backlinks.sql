-- Inbound backlinks in the document graph need an index on target_id.
-- The existing primary key covers outgoing (source_id,target_id,relation) only.
-- This migration preserves all existing links and is safe to apply incrementally.
CREATE INDEX IF NOT EXISTS record_links_by_target
ON record_links(target_id,relation,source_id);
