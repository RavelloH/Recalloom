-- Retire the temporary revision snapshot and quarantine tables introduced by
-- 0011 and 0012. This migration must also replay on a brand-new empty D1.
--
-- The original 0013 contained one production database's UUIDs, revisions and
-- SHA-256 values. Those assertions prevented fresh installations from running
-- all migrations. Instead enforce generic, fail-closed invariants:
--   1. With no sidecar data (normal on a fresh DB), remove the empty tables.
--   2. With quarantined histories, permit cleanup only if every snapshot is
--      the exact, independently registered current head of one quarantined
--      record, whose text-version metadata was rebased to a single head.
--   3. Any unquarantined snapshots, missing rows or mismatches abort the
--      migration rather than silently losing history.
--
-- Before applying to a populated database, preserve a separately verified
-- backup of the full schema and the quarantined original metadata.
CREATE TABLE _recalloom_0013_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _recalloom_0013_guard(ok)
SELECT CASE WHEN
  -- One and only one snapshot is allowed for each quarantined record.
  (SELECT COUNT(*) FROM record_revision_snapshots) =
  (SELECT COUNT(*) FROM record_history_quarantine)
  AND NOT EXISTS (
    SELECT 1
    FROM record_revision_snapshots s
    LEFT JOIN record_history_quarantine q ON q.record_id = s.record_id
    WHERE q.record_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM record_history_quarantine q
    LEFT JOIN record_contents c ON c.record_id = q.record_id
    LEFT JOIN record_histories h ON h.record_id = q.record_id
    LEFT JOIN revisions v
      ON v.record_id = q.record_id AND v.revision = c.revision
    LEFT JOIN record_revision_snapshots s
      ON s.record_id = q.record_id AND s.revision = c.revision
    WHERE c.record_id IS NULL
       OR h.record_id IS NULL
       OR v.record_id IS NULL
       OR s.record_id IS NULL
       OR q.original_revision != c.revision
       OR q.original_content_sha256 != c.content_sha256
       OR v.content_sha256 != c.content_sha256
       OR s.content_sha256 != c.content_sha256
       OR s.content != c.content
       OR h.history_metadata = q.original_metadata
       -- A rebased single-head text-version 2.x history starts with
       -- :<number-of-version-digits>:<current-revision>:
       OR h.history_metadata NOT LIKE
          ':' || LENGTH(CAST(c.revision AS TEXT)) || ':' ||
          CAST(c.revision AS TEXT) || ':%'
  )
THEN 1 ELSE 0 END;

-- Keep the current revision number (e.g. R12) and its SHA. Only records
-- explicitly quarantined by the earlier repair lose their old audit entries.
DELETE FROM revisions
WHERE record_id IN (SELECT record_id FROM record_history_quarantine)
  AND revision < (
    SELECT revision FROM record_contents WHERE record_id = revisions.record_id
  );

DROP TABLE record_revision_snapshots;
DROP TABLE record_history_quarantine;
DROP TABLE _recalloom_0013_guard;
