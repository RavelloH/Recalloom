-- Feed is a short-lived, structured intake channel, separate from Knowledge.
-- Observations are immutable source evidence; items merge exact source identities.
CREATE TABLE feed_items (
 id TEXT PRIMARY KEY,
 dedupe_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('news','release','insight','alert','digest')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
 summary TEXT NOT NULL DEFAULT '',
 why_relevant TEXT NOT NULL DEFAULT '',
 primary_url TEXT,
 published_at TEXT,
 first_seen_at TEXT NOT NULL,
 last_changed_at TEXT NOT NULL,
 expires_at TEXT,
 lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retracted')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE INDEX feed_items_recent ON feed_items(first_seen_at DESC,id DESC);
CREATE INDEX feed_items_published ON feed_items(published_at DESC,id DESC);
CREATE TABLE feed_observations (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
 actor TEXT NOT NULL,
 submission_key TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('web','github','paper','rss','internal','other')),
 source_url TEXT,
 publisher TEXT NOT NULL DEFAULT '',
 evidence_excerpt TEXT NOT NULL DEFAULT '',
 observed_at TEXT NOT NULL,
 source_published_at TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(actor,submission_key)
);
CREATE INDEX feed_observations_item ON feed_observations(item_id,created_at DESC);
CREATE INDEX feed_observations_actor_recent ON feed_observations(actor,created_at DESC);
CREATE TABLE feed_relations (
 item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
 target_type TEXT NOT NULL CHECK(target_type IN ('record','task','tag','collection')),
 target_id TEXT NOT NULL,
 relation TEXT NOT NULL CHECK(relation IN ('relevant_to','contradicts','promoted_to')),
 reason TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(item_id,target_type,target_id,relation)
);
CREATE INDEX feed_relations_target ON feed_relations(target_type,target_id);
CREATE TABLE feed_states (
 item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
 viewer_id TEXT NOT NULL DEFAULT 'owner',
 read_revision INTEGER NOT NULL DEFAULT 0,
 saved_at TEXT,
 dismissed_at TEXT,
 snoozed_until TEXT,
 feedback TEXT CHECK(feedback IN ('helpful','irrelevant')),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(item_id,viewer_id)
);
CREATE INDEX feed_states_saved ON feed_states(viewer_id,saved_at DESC) WHERE saved_at IS NOT NULL;
CREATE TABLE feed_feedback_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
 viewer_id TEXT NOT NULL,
 action TEXT NOT NULL,
 value TEXT,
 item_revision INTEGER NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX feed_feedback_events_item ON feed_feedback_events(item_id,seq DESC);
