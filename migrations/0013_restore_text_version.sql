-- 0013: restore text-version as the only historical content engine.
-- Deploy the new code and create an independent verified backup BEFORE applying.
-- Guard all four repaired heads against stale revision or checksum.
CREATE TABLE _recalloom_0013_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO _recalloom_0013_guard(ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM record_contents WHERE (record_id='8eb167c4-f2ea-467c-a94a-a3bafed96615' AND revision=12 AND content_sha256='1ac563c3b9d9236ae36b5de832cc20780c689226474393d5278dfa53310b20e7') OR (record_id='5ba6a282-292b-451e-9ae1-aed47c3a20ce' AND revision=6 AND content_sha256='a9ec1ac6149d5be12fdb6e94122ace395a7d39256a4ae77364781d982fe7b059') OR (record_id='5f6fbfcf-bbea-4e54-8749-18c7e170b44c' AND revision=4 AND content_sha256='020d4bf6fcdc9e07a113331994240ddbfd4b2e78c948e21bd12b654625bb8d10') OR (record_id='4fb2959b-920b-4fed-9a71-361edb5d637c' AND revision=8 AND content_sha256='e2936e96fe2da56f8bbc59ad8386927c60f06caa3a2cac564ebdd71143632123')) = 4
  AND (SELECT COUNT(*) FROM record_history_quarantine) = 4
  AND (SELECT COUNT(*) FROM record_revision_snapshots) = 4
  AND (SELECT COUNT(*) FROM revisions WHERE record_id IN ('8eb167c4-f2ea-467c-a94a-a3bafed96615','5ba6a282-292b-451e-9ae1-aed47c3a20ce','5f6fbfcf-bbea-4e54-8749-18c7e170b44c','4fb2959b-920b-4fed-9a71-361edb5d637c')) = 30
THEN 1 ELSE 0 END;
-- Preserve the original current revision numbers, dropping only old untrusted
-- history indexes. Current text-version metadata already has one valid head.
DELETE FROM revisions
WHERE record_id IN ('8eb167c4-f2ea-467c-a94a-a3bafed96615','5ba6a282-292b-451e-9ae1-aed47c3a20ce','5f6fbfcf-bbea-4e54-8749-18c7e170b44c','4fb2959b-920b-4fed-9a71-361edb5d637c')
  AND revision < (SELECT revision FROM record_contents WHERE record_id=revisions.record_id);
DROP TABLE record_revision_snapshots;
DROP TABLE record_history_quarantine;
DROP TABLE _recalloom_0013_guard;
