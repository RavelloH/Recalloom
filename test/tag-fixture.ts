import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { initialVersion, sha256 } from '../src/version.js';
import type { Env } from '../src/types.js';

export function fixture(beforeTagMigration = false) {
  const db = new DatabaseSync(':memory:'),
    directory = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith('.sql') && !(beforeTagMigration && name >= '0024'))
    .sort())
    db.exec(readFileSync(new URL(file, directory), 'utf8'));
  class Statement {
    values: (string | number | null)[] = [];
    constructor(readonly sql: string) {}
    bind(...values: (string | number | null)[]) {
      this.values = values;
      return this;
    }
    async first() {
      return db.prepare(this.sql).get(...this.values) ?? null;
    }
    async all() {
      return { results: db.prepare(this.sql).all(...this.values) };
    }
    async run() {
      return { meta: { changes: Number(db.prepare(this.sql).run(...this.values).changes) } };
    }
  }
  const env = {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        db.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) {
            const prepared = db.prepare(statement.sql);
            if (/^\s*(SELECT|WITH)/i.test(statement.sql))
              results.push({ results: prepared.all(...statement.values) });
            else
              results.push({
                results: [],
                meta: { changes: Number(prepared.run(...statement.values).changes) }
              });
          }
          db.exec('COMMIT');
          return results;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
    }
  } as unknown as Env;
  async function record(name: string, content: string, kind = 'document', status = 'active') {
    const id = crypto.randomUUID(),
      hash = await sha256(content),
      date = '2026-11-15T10:00:00.000Z';
    db.prepare(
      'INSERT INTO records(id,name,kind,status,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
    ).run(id, name, kind, status, '', date, date);
    db.prepare(
      'INSERT INTO record_contents(record_id,content,revision,content_sha256) VALUES(?,?,1,?)'
    ).run(id, content, hash);
    db.prepare('INSERT INTO record_histories(record_id,history_metadata) VALUES(?,?)').run(
      id,
      initialVersion(content).metadata
    );
    db.prepare(
      'INSERT INTO revisions(record_id,revision,content_sha256,message,actor,created_at) VALUES(?,1,?,?,?,?)'
    ).run(id, hash, 'Created', 'test', date);
    return id;
  }
  async function list(name: string, titles: string[], status = 'active') {
    const tasks = titles.map((title) => ({
      id: crypto.randomUUID(),
      title,
      details: 'Details ' + title,
      status: 'todo',
      priority: 0
    }));
    const id = await record(name, JSON.stringify({ tasks }, null, 2), 'task_list', status);
    for (const [index, task] of tasks.entries()) {
      db.prepare(
        'INSERT INTO tasks(id,record_id,title,details,status,priority,position,updated_at) VALUES(?,?,?,?,?,?,?,?)'
      ).run(task.id, id, task.title, task.details, task.status, 0, index, '2026-11-15');
      db.prepare('INSERT INTO task_board_order(task_id,record_id,position) VALUES(?,?,?)').run(
        task.id,
        id,
        1024 * (index + 1)
      );
    }
    return { id, tasks };
  }
  return { db, env, record, list };
}
