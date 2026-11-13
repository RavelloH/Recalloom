-- Feed the homepage from saved content revisions, not metadata-only updates.
-- Walk newest revisions first and join only current revisions of active records.
CREATE INDEX revisions_recent_content ON revisions(created_at DESC, record_id, revision);
