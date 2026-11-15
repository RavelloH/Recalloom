-- Persist a global per-status board order independently from each task list's
-- canonical JSON array. Do not reference tasks: task projections are rebuilt
-- with DELETE/INSERT on every content revision.
CREATE TABLE task_board_order (
  task_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  position REAL NOT NULL
);
CREATE INDEX task_board_order_record ON task_board_order(record_id);
CREATE INDEX task_board_order_position ON task_board_order(position,task_id);

INSERT INTO task_board_order(task_id,record_id,position)
SELECT t.id,t.record_id,
  ROW_NUMBER() OVER (
    ORDER BY t.record_id,
      CASE WHEN json_extract(c.content,'$.taskOrder')='manual' THEN 0 ELSE -t.priority END,
      t.position,t.id
  )*1024.0
FROM tasks t
JOIN record_contents c ON c.record_id=t.record_id;
