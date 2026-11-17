import { prepareDocumentTags } from './tags/engine.js';
import type { Env } from './types.js';
import { StorageError } from './types.js';
import { paragraphChunks } from './search-ranking.js';
import { sha256 } from './version.js';
import { tagBatch, tagGuard } from './tags/catalog.js';

export const EMBEDDING_MODEL = '@cf/google/embeddinggemma-2';
export const EMBEDDING_DIMENSIONS = 512;
export const splitText = paragraphChunks;

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const result = await env.AI.run(EMBEDDING_MODEL, {
    input: texts, dimensions: EMBEDDING_DIMENSIONS
  }) as unknown as { data?: Array<{ embedding?: unknown }> };
  if (!Array.isArray(result.data) || result.data.length !== texts.length)
    throw new StorageError('EMBEDDING_FAILED');
  return result.data.map(item => {
    const vector = item?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS ||
        !vector.every(value => typeof value === 'number' && Number.isFinite(value)))
      throw new StorageError('EMBEDDING_FAILED');
    return vector as number[];
  });
}

type Job = {
  id: string; record_id: string; revision: number;
  generation: number; attempts: number; stage: string;
  indexed_revision: number | null; vector_generation: number | null;
};
const iso = () => new Date().toISOString();
const MIN_NEXT_JOB_BUDGET_MS = 20_000;
export async function cleanupIndexVectors(env: Env) {
  const rows = (await env.DB.prepare(
    'SELECT id,chunk_ids FROM index_vector_garbage WHERE not_before<=? LIMIT 10'
  ).bind(iso()).all<{ id: string; chunk_ids: string }>()).results;
  for (const row of rows) try {
    const ids = JSON.parse(row.chunk_ids) as string[];
    for (let i = 0; i < ids.length; i += 100)
      await env.VECTORIZE.deleteByIds(ids.slice(i, i + 100));
    await env.DB.prepare('DELETE FROM index_vector_garbage WHERE id=?').bind(row.id).run();
  } catch (error) {
    await env.DB.prepare('UPDATE index_vector_garbage SET last_error=? WHERE id=?')
      .bind(String(error).slice(0, 800), row.id).run();
  }
}

export async function processIndexJobs(
  env: Env, limit = 3, recordId?: string, deadline = Date.now() + 75_000
) {
  const timestamp = iso();
  await env.DB.prepare(
    `UPDATE index_jobs SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'retry' END,
    stage=CASE WHEN vector_generation=generation AND indexed_revision=revision
      THEN 'tagging' ELSE 'queued' END,
    lease_token=NULL,lease_expires_at=NULL,next_retry_at=CASE WHEN attempts>=5 THEN NULL ELSE ? END,
    last_error='Background execution timed out'
    WHERE state='running' AND lease_expires_at<?`
  ).bind(timestamp, timestamp).run();
  const jobs = (await env.DB.prepare(
    `SELECT id,record_id,revision,generation,attempts,stage,indexed_revision,vector_generation
     FROM index_jobs WHERE (state='pending' OR (state='retry' AND next_retry_at<=?))
     AND (? IS NULL OR record_id=?) ORDER BY updated_at,created_at LIMIT ?`
  ).bind(timestamp, recordId ?? null, recordId ?? null,
    Math.max(1, Math.min(10, limit))).all<Job>()).results;
  const results: Array<{ id: string; chunks?: number; skipped?: string; error?: string }> = [];
  for (const job of jobs) {
    if (Date.now() >= deadline ||
        (results.length > 0 && deadline - Date.now() < MIN_NEXT_JOB_BUDGET_MS)) break;
    const token = crypto.randomUUID(), start = Date.now();
    const lease = new Date(start + 90_000).toISOString();
    const claimed = await env.DB.prepare(
      `UPDATE index_jobs SET state='running',started_at=?,lease_token=?,lease_expires_at=?,
       attempts=attempts+1 WHERE id=? AND generation=? AND state IN ('pending','retry')`
    ).bind(iso(), token, lease, job.id, job.generation).run();
    if (!claimed.meta.changes) {
      results.push({ id: job.id, skipped: 'claimed_elsewhere' });
      continue;
    }
    let total = 0;
    const guardCondition =
      `EXISTS(SELECT 1 FROM index_jobs WHERE id=? AND generation=? AND lease_token=?
        AND lease_expires_at>? AND state='running')
       AND EXISTS(SELECT 1 FROM records r JOIN record_contents c ON c.record_id=r.id
        WHERE r.id=? AND r.name=? AND c.revision=?)`;
    const guardArgs = (name: string) => [
      job.id, job.generation, token, iso(), job.record_id, name, job.revision
    ];
    const progress = async (stage: string, completed: number) => {
      const result = await env.DB.prepare(
        `UPDATE index_jobs SET stage=?,completed_chunks=?,total_chunks=?
         WHERE id=? AND generation=? AND lease_token=? AND state='running'`
      ).bind(stage, completed, total, job.id, job.generation, token).run();
      if (!result.meta.changes) throw new StorageError('INDEX_SUPERSEDED');
    };
    try {
      const record = await env.DB.prepare(
        `SELECT r.id,r.name,r.status,c.content,c.revision FROM records r
         JOIN record_contents c ON c.record_id=r.id WHERE r.id=?`
      ).bind(job.record_id).first<{
        id: string; name: string; status: string; content: string; revision: number;
      }>();
      if (!record || record.revision !== job.revision)
        throw new StorageError('INDEX_SUPERSEDED');
      const reuse = job.vector_generation === job.generation &&
        job.indexed_revision === job.revision && job.stage === 'tagging';
      let vectors: number[][] = [];
      if (reuse) {
        const rows = (await env.DB.prepare(
          `SELECT chunk_id AS id FROM search_chunks WHERE record_id=? AND revision=?
           ORDER BY chunk_index`
        ).bind(job.record_id, job.revision).all<{ id: string }>()).results;
        total = rows.length;
        const stored = rows.length ? await env.VECTORIZE.getByIds(rows.map(row => row.id)) : [];
        const byId = new Map(stored.map(row => [row.id, row]));
        if (stored.length !== rows.length || rows.some(row => !byId.get(row.id)?.values?.length))
          throw new StorageError('INDEX_VECTORS_PENDING');
        vectors = rows.map(row => Array.from(byId.get(row.id)!.values) as number[]);
      } else {
        const old = (await env.DB.prepare(
          'SELECT chunk_id FROM search_chunks WHERE record_id=?'
        ).bind(record.id).all<{ chunk_id: string }>()).results.map(row => row.chunk_id);
        const chunks = record.status === 'archived'
          ? [] : splitText(record.name + '\n' + record.content);
        total = chunks.length;
        await progress('embedding', 0);
        for (let i = 0; i < chunks.length; i += 8) {
          vectors.push(...await embed(env, chunks.slice(i, i + 8).map(
            chunk => 'title: ' + record.name.replace(/\.md$/i, '') + ' | text: ' + chunk
          )));
          await progress('embedding', Math.min(i + 8, total));
        }
        const prefix = (await sha256(record.id + ':' + job.generation + ':' + token)).slice(0, 40);
        const ids = chunks.map((_, i) => prefix + ':' + i);
        if (ids.length) await env.DB.prepare(
          'INSERT INTO index_vector_garbage(id,chunk_ids,not_before) VALUES(?,?,?)'
        ).bind(token, JSON.stringify(ids), new Date(start + 3_600_000).toISOString()).run();

        const upload = async () => {
          await progress('uploading', 0);
          for (let i = 0; i < ids.length; i += 8)
            await env.VECTORIZE.upsert(ids.slice(i, i + 8).map((id, j) => ({
              id, values: vectors[i + j]!,
              metadata: { record_id: record.id, revision: record.revision, chunk_index: i + j }
            })));
          const statements = [
            tagGuard(env, guardCondition, guardArgs(record.name)),
            env.DB.prepare('DELETE FROM search_chunks WHERE record_id=?').bind(record.id)
          ];
          for (let i = 0; i < chunks.length; i++)
            statements.push(env.DB.prepare(
              'INSERT INTO search_chunks(chunk_id,record_id,revision,chunk_index,content) VALUES(?,?,?,?,?)'
            ).bind(ids[i], record.id, record.revision, i, chunks[i]));
          if (old.length) statements.push(env.DB.prepare(
            'INSERT INTO index_vector_garbage(id,chunk_ids,not_before) VALUES(?,?,?)'
          ).bind(token + '-old', JSON.stringify(old), iso()));
          if (ids.length) statements.push(
            env.DB.prepare('DELETE FROM index_vector_garbage WHERE id=?').bind(token)
          );
          statements.push(env.DB.prepare(
            `UPDATE index_jobs SET stage='tagging',indexed_revision=?,
             vector_generation=?,completed_chunks=?,total_chunks=? WHERE id=? AND lease_token=?`
          ).bind(record.revision, job.generation, total, total, job.id, token));
          await tagBatch(env, statements);
        };
        // The newly embedded raw vectors can be queried while upserts proceed.
        const tagWork = record.status === 'archived'
          ? Promise.resolve(null)
          : prepareDocumentTags(env, record.id, vectors);
        const settled = await Promise.allSettled([upload(), tagWork]);
        const failed = settled.find((part): part is PromiseRejectedResult =>
          part.status === 'rejected');
        if (failed) throw failed.reason;
        const plan = (settled[1] as PromiseFulfilledResult<
          Awaited<ReturnType<typeof prepareDocumentTags>> | null
        >).value;
        await completeIndex(env, job, token, record.name, guardCondition, guardArgs, plan);
        await logRun(env, token, job, 'done', total, Date.now() - start, null);
        results.push({ id: job.id, chunks: total });
        continue;
      }
      // Retry after a successful upload: reuse persisted vectors, skip Embedding.
      const plan = record.status === 'archived'
        ? null : await prepareDocumentTags(env, record.id, vectors);
      await completeIndex(env, job, token, record.name, guardCondition, guardArgs, plan);
      await logRun(env, token, job, 'done', total, Date.now() - start, null);
      results.push({ id: job.id, chunks: total });
    } catch (error) {
      const superseded = error instanceof StorageError &&
        (error.code === 'INDEX_SUPERSEDED' || error.code === 'METADATA_CONFLICT');
      const message = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(
        `UPDATE index_jobs SET
         state=CASE WHEN generation<>? THEN 'pending'
           WHEN attempts>=5 THEN 'failed' ELSE 'retry' END,
         attempts=CASE WHEN generation<>? THEN 0 ELSE attempts END,
         stage=CASE WHEN generation=? AND vector_generation=generation
           AND indexed_revision=revision THEN 'tagging' ELSE 'queued' END,
         next_retry_at=CASE WHEN generation<>? OR attempts>=5 THEN NULL ELSE ? END,
         last_error=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?`
      ).bind(job.generation, job.generation, job.generation, job.generation,
        new Date(Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000).toISOString(),
        superseded ? null : message.slice(0, 800), job.id, token).run();
      await logRun(env, token, job, superseded ? 'superseded' : 'failed',
        total, Date.now() - start, superseded ? null : message.slice(0, 800));
      results.push({ id: job.id, ...(superseded ?
        { skipped: 'superseded' } : { error: message }) });
    }
  }
  return { processed: results.length, results };
}

async function completeIndex(
  env: Env, job: Job, token: string, name: string,
  guardCondition: string, guardArgs: (name: string) => unknown[],
  plan: Awaited<ReturnType<typeof prepareDocumentTags>> | null
) {
  const writes = [
    tagGuard(env, guardCondition +
      ` AND EXISTS(SELECT 1 FROM index_jobs WHERE id=? AND vector_generation=?
         AND stage='tagging' AND indexed_revision=?)`,
      [...guardArgs(name), job.id, job.generation, job.revision]),
    ...(plan?.guards ?? []),
    ...(plan?.statements ?? []),
    env.DB.prepare(
      `UPDATE index_jobs SET state='done',stage='completed',
       finished_at=?,last_error=NULL,lease_token=NULL,lease_expires_at=NULL
       WHERE id=? AND generation=? AND lease_token=?`
    ).bind(iso(), job.id, job.generation, token)
  ];
  await tagBatch(env, writes);
}

async function logRun(
  env: Env, id: string, job: Job, outcome: string,
  chunks: number, duration: number, error: string | null
) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO index_runs
     (id,record_id,revision,outcome,chunks,duration_ms,created_at,error)
     VALUES(?,?,?,?,?,?,?,?)`
  ).bind(id, job.record_id, job.revision, outcome, chunks, duration, iso(), error).run();
}

export async function drainIndexJobs(env: Env) {
  if (env.INDEX_BACKGROUND_ENABLED === 'false') return;
  const deadline = Date.now() + 24_000;
  do {
    const result = await processIndexJobs(env, 1, undefined, deadline);
    if (!result.processed) break;
  } while (deadline - Date.now() >= MIN_NEXT_JOB_BUDGET_MS);
}
