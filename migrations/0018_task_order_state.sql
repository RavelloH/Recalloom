CREATE TABLE task_order_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  version INTEGER NOT NULL CHECK(version>=0)
);
INSERT INTO task_order_state(id,version) VALUES(1,1);

CREATE TRIGGER task_order_task_list_visibility
AFTER UPDATE OF status ON records
WHEN OLD.kind='task_list' AND ((OLD.status='archived')<>(NEW.status='archived'))
BEGIN
  UPDATE task_order_state SET version=version+1 WHERE id=1;
END;

CREATE TRIGGER task_order_task_list_delete
AFTER DELETE ON records
WHEN OLD.kind='task_list'
BEGIN
  UPDATE task_order_state SET version=version+1 WHERE id=1;
END;

CREATE TABLE task_mutation_requests (
  request_id TEXT PRIMARY KEY,
  input_sha256 TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
