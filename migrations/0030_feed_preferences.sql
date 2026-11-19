-- Explicit recommendation preference is one exclusive level; read status remains revision-aware.
-- Retain previous columns as historical compatibility data, but new clients use preference.
ALTER TABLE feed_states ADD COLUMN preference TEXT CHECK(preference IN ('saved','interested','not_interested'));
ALTER TABLE feed_states ADD COLUMN preference_updated_at TEXT;
UPDATE feed_states SET
 preference=CASE WHEN saved_at IS NOT NULL THEN 'saved'
  WHEN feedback='irrelevant' OR dismissed_at IS NOT NULL THEN 'not_interested'
  WHEN feedback='helpful' THEN 'interested' ELSE NULL END,
 preference_updated_at=CASE WHEN saved_at IS NOT NULL OR feedback IS NOT NULL OR dismissed_at IS NOT NULL
  THEN updated_at ELSE NULL END;
CREATE INDEX feed_states_preference_recent ON feed_states(viewer_id,preference,preference_updated_at DESC,item_id DESC);
CREATE INDEX feed_items_effective_recent ON feed_items(COALESCE(published_at,first_seen_at) DESC,id DESC);

-- Source timestamps may contain timezone offsets. SQLite textual sort must use one UTC form.
UPDATE feed_items SET published_at=strftime('%Y-%m-%dT%H:%M:%fZ',published_at)
 WHERE published_at IS NOT NULL;
UPDATE feed_items SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',expires_at)
 WHERE expires_at IS NOT NULL;
UPDATE feed_observations SET source_published_at=strftime('%Y-%m-%dT%H:%M:%fZ',source_published_at)
 WHERE source_published_at IS NOT NULL;
