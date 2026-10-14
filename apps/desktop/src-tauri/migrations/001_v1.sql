PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  expected_secs INTEGER NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NULL,
  expected_secs INTEGER NULL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ix_entries_task ON entries(task_id);
CREATE INDEX IF NOT EXISTS ix_entries_started ON entries(started_at);
CREATE INDEX IF NOT EXISTS ix_entries_open ON entries(ended_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_task_tags_tag ON task_tags(tag_id);
