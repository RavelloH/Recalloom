-- Derived display text and pinned source coordinates. Existing chunks use the
-- live-source fallback until their projections are backfilled or reindexed.
ALTER TABLE search_chunks ADD COLUMN excerpt_projection TEXT;
