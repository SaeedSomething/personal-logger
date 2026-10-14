/*
# Create task logger schema

1. New Tables
- `logger_tasks`: reusable task definitions with title, estimate, notes, and timestamps.
- `logger_tags`: reusable user-created labels.
- `logger_task_tags`: links tasks to tags.
- `logger_entries`: individual start/end records for each task, including the estimate used at start and optional notes.

2. Security
- Row level security is enabled on every table.
- This is a single-tenant personal app without sign-in, so anon and authenticated roles can access the shared local workspace.
- Four explicit CRUD policies are created per table.

3. Notes
- Entries remain separate from tasks so the journal can show each session as well as aggregated task measurements.
- Open entries are represented by a null `ended_at` value.
*/

CREATE TABLE IF NOT EXISTS logger_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  default_estimate_minutes integer NOT NULL DEFAULT 30 CHECK (default_estimate_minutes > 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logger_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logger_task_tags (
  task_id uuid NOT NULL REFERENCES logger_tasks(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES logger_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS logger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES logger_tasks(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  expected_minutes integer NOT NULL CHECK (expected_minutes > 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logger_entries_task_id_idx ON logger_entries(task_id);
CREATE INDEX IF NOT EXISTS logger_entries_started_at_idx ON logger_entries(started_at DESC);
CREATE INDEX IF NOT EXISTS logger_task_tags_tag_id_idx ON logger_task_tags(tag_id);

ALTER TABLE logger_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE logger_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE logger_task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE logger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_select_logger_tasks" ON logger_tasks;
DROP POLICY IF EXISTS "workspace_insert_logger_tasks" ON logger_tasks;
DROP POLICY IF EXISTS "workspace_update_logger_tasks" ON logger_tasks;
DROP POLICY IF EXISTS "workspace_delete_logger_tasks" ON logger_tasks;
CREATE POLICY "workspace_select_logger_tasks" ON logger_tasks FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "workspace_insert_logger_tasks" ON logger_tasks FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "workspace_update_logger_tasks" ON logger_tasks FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "workspace_delete_logger_tasks" ON logger_tasks FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "workspace_select_logger_tags" ON logger_tags;
DROP POLICY IF EXISTS "workspace_insert_logger_tags" ON logger_tags;
DROP POLICY IF EXISTS "workspace_update_logger_tags" ON logger_tags;
DROP POLICY IF EXISTS "workspace_delete_logger_tags" ON logger_tags;
CREATE POLICY "workspace_select_logger_tags" ON logger_tags FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "workspace_insert_logger_tags" ON logger_tags FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "workspace_update_logger_tags" ON logger_tags FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "workspace_delete_logger_tags" ON logger_tags FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "workspace_select_logger_task_tags" ON logger_task_tags;
DROP POLICY IF EXISTS "workspace_insert_logger_task_tags" ON logger_task_tags;
DROP POLICY IF EXISTS "workspace_update_logger_task_tags" ON logger_task_tags;
DROP POLICY IF EXISTS "workspace_delete_logger_task_tags" ON logger_task_tags;
CREATE POLICY "workspace_select_logger_task_tags" ON logger_task_tags FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "workspace_insert_logger_task_tags" ON logger_task_tags FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "workspace_update_logger_task_tags" ON logger_task_tags FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "workspace_delete_logger_task_tags" ON logger_task_tags FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "workspace_select_logger_entries" ON logger_entries;
DROP POLICY IF EXISTS "workspace_insert_logger_entries" ON logger_entries;
DROP POLICY IF EXISTS "workspace_update_logger_entries" ON logger_entries;
DROP POLICY IF EXISTS "workspace_delete_logger_entries" ON logger_entries;
CREATE POLICY "workspace_select_logger_entries" ON logger_entries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "workspace_insert_logger_entries" ON logger_entries FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "workspace_update_logger_entries" ON logger_entries FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "workspace_delete_logger_entries" ON logger_entries FOR DELETE TO anon, authenticated USING (true);
