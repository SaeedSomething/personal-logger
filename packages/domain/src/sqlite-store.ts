import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  computeRollups,
  filterEntriesByFromMs,
  habitDays,
  journalWindowFromMs,
} from './journal.js';
import { applyMigrations } from './migrations/index.js';
import type {
  Clock,
  EntryRecord,
  ExpectedTarget,
  JournalSnapshot,
  JournalWindow,
  SearchHit,
  TagRecord,
  TaskRecord,
} from './models.js';
import { normalizeName, normalizeTagName, requireName } from './normalize.js';
import type { LogRepository } from './repository.js';

type SqlParams = SQLInputValue[];

type TaskRow = {
  id: string;
  name: string;
  expected_secs: number | null;
  notes: string;
  created_at: number;
};

type EntryRow = {
  id: string;
  task_id: string;
  name: string;
  started_at: number;
  ended_at: number | null;
  expected_secs: number | null;
  notes: string;
};

const systemClock: Clock = {
  nowMs: () => Date.now(),
};

export type SqliteLogStoreOptions = {
  /** File path or `:memory:`. */
  path: string;
  clock?: Clock;
};

/**
 * Node SQLite implementation of LogRepository (for tests and tooling).
 * UI adapters may reimplement against tauri-plugin-sql using the same migrations.
 */
export class SqliteLogStore implements LogRepository {
  private readonly db: DatabaseSync;
  private readonly clock: Clock;
  private closed = false;

  constructor(options: SqliteLogStoreOptions) {
    if (!options.path || options.path.trim() === '') {
      throw new Error('Database path is required.');
    }

    this.clock = options.clock ?? systemClock;
    this.db = new DatabaseSync(options.path);
    applyMigrations({
      exec: (sql) => this.db.exec(sql),
      prepare: (sql) => ({
        get: (...params: SQLInputValue[]) =>
          this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
      }),
    });
  }

  search(query?: string | null): SearchHit[] {
    this.assertOpen();
    const q = normalizeName(query);
    const opens = this.readOpen(q);
    const tasks = this.readTasks(q);

    const orderedOpens =
      q.length === 0
        ? [...opens].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
        : [...opens].sort((a, b) => {
            const rank = rankName(a.name, q) - rankName(b.name, q);
            return rank !== 0 ? rank : (b.startedAt ?? 0) - (a.startedAt ?? 0);
          });

    const orderedTasks =
      q.length === 0
        ? [...tasks].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
        : [...tasks].sort((a, b) => {
            const rank = rankName(a.name, q) - rankName(b.name, q);
            return rank !== 0 ? rank : (b.startedAt ?? 0) - (a.startedAt ?? 0);
          });

    return [...orderedOpens.slice(0, 20), ...orderedTasks.slice(0, 20)];
  }

  start(
    name: string,
    options?: { notes?: string; tagNames?: string[] },
  ): EntryRecord {
    this.assertOpen();
    const normalized = requireName(name);
    const now = this.clock.nowMs();

    this.db.exec('BEGIN;');
    try {
      const task = this.getOrCreateTask(normalized, now);
      if (options?.tagNames && options.tagNames.length > 0) {
        this.replaceTaskTags(task.id, options.tagNames, now);
      }

      const id = randomUUID();
      const notes = options?.notes ?? '';
      this.db
        .prepare(
          `INSERT INTO entries(id, task_id, started_at, ended_at, expected_secs, notes)
           VALUES (?, ?, ?, NULL, ?, ?)`,
        )
        .run(id, task.id, now, task.expected_secs, notes);

      this.db.exec('COMMIT;');
      return {
        id,
        taskId: task.id,
        name: task.name,
        startedAt: now,
        endedAt: null,
        expectedSecs: task.expected_secs,
        notes,
      };
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  end(entryId: string): EntryRecord {
    this.assertOpen();
    const now = this.clock.nowMs();
    const result = this.db
      .prepare(
        `UPDATE entries SET ended_at = ? WHERE id = ? AND ended_at IS NULL`,
      )
      .run(now, entryId);

    if (result.changes !== 1) {
      throw new Error('That entry is not open.');
    }

    const entry = this.readEntry(entryId);
    if (!entry) {
      throw new Error('That entry is not open.');
    }

    return entry;
  }

  setExpected(target: ExpectedTarget, seconds: number): void {
    this.assertOpen();
    if (seconds <= 0) {
      throw new Error('Expected duration must be positive seconds.');
    }

    switch (target.type) {
      case 'task': {
        this.updateIfExists(
          `UPDATE tasks SET expected_secs = ? WHERE id = ?`,
          `SELECT COUNT(*) AS c FROM tasks WHERE id = ?`,
          [seconds, target.taskId],
          [target.taskId],
        );
        break;
      }
      case 'entry': {
        this.updateIfExists(
          `UPDATE entries SET expected_secs = ? WHERE id = ?`,
          `SELECT COUNT(*) AS c FROM entries WHERE id = ?`,
          [seconds, target.entryId],
          [target.entryId],
        );
        break;
      }
      case 'name': {
        const now = this.clock.nowMs();
        this.db.exec('BEGIN;');
        try {
          const task = this.getOrCreateTask(requireName(target.name), now);
          this.db
            .prepare(`UPDATE tasks SET expected_secs = ? WHERE id = ?`)
            .run(seconds, task.id);
          this.db.exec('COMMIT;');
        } catch (error) {
          this.db.exec('ROLLBACK;');
          throw error;
        }
        break;
      }
      default: {
        const _exhaustive: never = target;
        throw new Error(`Unknown expected target: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  loadJournal(options?: {
    window?: JournalWindow;
    fromMs?: number | null;
    focusName?: string | null;
    timeZone?: string;
  }): JournalSnapshot {
    this.assertOpen();
    const timeZone = options?.timeZone ?? 'UTC';
    const window: JournalWindow = options?.window ?? 'all';
    const now = this.clock.nowMs();

    let fromMs: number | null;
    if (options?.fromMs !== undefined) {
      fromMs = options.fromMs;
    } else {
      fromMs = journalWindowFromMs(window, now);
    }

    const openEntries = this.readEntryList(
      `SELECT e.id, e.task_id, t.name, e.started_at, e.ended_at, e.expected_secs, e.notes
       FROM entries e
       JOIN tasks t ON t.id = e.task_id
       WHERE e.ended_at IS NULL
       ORDER BY e.started_at DESC`,
    );

    const allInWindow = this.readEntryList(
      fromMs == null
        ? `SELECT e.id, e.task_id, t.name, e.started_at, e.ended_at, e.expected_secs, e.notes
           FROM entries e
           JOIN tasks t ON t.id = e.task_id
           ORDER BY e.started_at DESC`
        : `SELECT e.id, e.task_id, t.name, e.started_at, e.ended_at, e.expected_secs, e.notes
           FROM entries e
           JOIN tasks t ON t.id = e.task_id
           WHERE e.started_at >= ?
           ORDER BY e.started_at DESC`,
      fromMs == null ? [] : [fromMs],
    );

    // Re-filter in memory so window helpers stay authoritative for tests.
    const windowed = filterEntriesByFromMs(allInWindow, fromMs);
    const rollups = computeRollups(windowed, now);

    const requested = normalizeName(options?.focusName);
    const focus = requested.length === 0 ? null : this.findTaskByName(requested);
    const entries =
      requested.length === 0
        ? windowed
        : focus == null
          ? []
          : windowed.filter((entry) => entry.taskId === focus.id);

    const days =
      focus == null
        ? []
        : habitDays({
            entries: this.readEntryList(
              `SELECT e.id, e.task_id, t.name, e.started_at, e.ended_at, e.expected_secs, e.notes
               FROM entries e
               JOIN tasks t ON t.id = e.task_id
               WHERE e.task_id = ?`,
              [focus.id],
            ),
            fromMs,
            nowMs: now,
            timeZone,
          });

    return {
      openEntries,
      entries,
      tasks: rollups,
      days,
      window,
      fromMs,
    };
  }

  getTask(taskId: string): TaskRecord | null {
    this.assertOpen();
    const row = this.db
      .prepare(
        `SELECT id, name, expected_secs, notes, created_at FROM tasks WHERE id = ?`,
      )
      .get(taskId) as TaskRow | undefined;
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      expectedSecs: row.expected_secs,
      notes: row.notes,
      createdAt: row.created_at,
      tagNames: this.tagNamesForTask(row.id),
    };
  }

  listTags(): TagRecord[] {
    this.assertOpen();
    const rows = this.db
      .prepare(`SELECT id, name, created_at FROM tags ORDER BY name COLLATE NOCASE`)
      .all() as Array<{ id: string; name: string; created_at: number }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    }));
  }

  ensureTag(name: string): TagRecord {
    this.assertOpen();
    const normalized = normalizeTagName(name);
    const existing = this.findTagByName(normalized);
    if (existing) {
      return existing;
    }

    const now = this.clock.nowMs();
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO tags(id, name, created_at) VALUES (?, ?, ?)`)
      .run(id, normalized, now);
    return { id, name: normalized, createdAt: now };
  }

  setTaskTags(taskId: string, tagNames: string[]): void {
    this.assertOpen();
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error('Nothing was updated.');
    }

    const now = this.clock.nowMs();
    this.db.exec('BEGIN;');
    try {
      this.replaceTaskTags(taskId, tagNames, now);
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  setTaskNotes(taskId: string, notes: string): void {
    this.assertOpen();
    this.updateIfExists(
      `UPDATE tasks SET notes = ? WHERE id = ?`,
      `SELECT COUNT(*) AS c FROM tasks WHERE id = ?`,
      [notes, taskId],
      [taskId],
    );
  }

  setEntryNotes(entryId: string, notes: string): void {
    this.assertOpen();
    this.updateIfExists(
      `UPDATE entries SET notes = ? WHERE id = ?`,
      `SELECT COUNT(*) AS c FROM entries WHERE id = ?`,
      [notes, entryId],
      [entryId],
    );
  }

  deleteTask(taskId: string): void {
    this.assertOpen();
    const result = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
    if (result.changes !== 1) {
      throw new Error('Nothing was updated.');
    }
  }

  deleteEntry(entryId: string): void {
    this.assertOpen();
    const result = this.db.prepare(`DELETE FROM entries WHERE id = ?`).run(entryId);
    if (result.changes !== 1) {
      throw new Error('Nothing was updated.');
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Store is closed.');
    }
  }

  private updateIfExists(
    updateSql: string,
    existsSql: string,
    updateParams: SqlParams,
    existsParams: SqlParams,
  ): void {
    this.db.prepare(updateSql).run(...updateParams);
    const row = this.db.prepare(existsSql).get(...existsParams) as { c: number };
    if (Number(row.c) !== 1) {
      throw new Error('Nothing was updated.');
    }
  }

  private getOrCreateTask(name: string, now: number): TaskRow {
    const existing = this.findTaskByName(name);
    if (existing) {
      return existing;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tasks(id, name, expected_secs, notes, created_at)
         VALUES (?, ?, NULL, '', ?)`,
      )
      .run(id, name, now);

    return {
      id,
      name,
      expected_secs: null,
      notes: '',
      created_at: now,
    };
  }

  private findTaskByName(name: string): TaskRow | null {
    const row = this.db
      .prepare(
        `SELECT id, name, expected_secs, notes, created_at
         FROM tasks WHERE name = ? COLLATE NOCASE LIMIT 1`,
      )
      .get(name) as TaskRow | undefined;
    return row ?? null;
  }

  private findTagByName(name: string): TagRecord | null {
    const row = this.db
      .prepare(`SELECT id, name, created_at FROM tags WHERE name = ? COLLATE NOCASE LIMIT 1`)
      .get(name) as { id: string; name: string; created_at: number } | undefined;
    if (!row) {
      return null;
    }

    return { id: row.id, name: row.name, createdAt: row.created_at };
  }

  private replaceTaskTags(taskId: string, tagNames: string[], now: number): void {
    this.db.prepare(`DELETE FROM task_tags WHERE task_id = ?`).run(taskId);
    const seen = new Set<string>();
    for (const raw of tagNames) {
      const normalized = normalizeTagName(raw);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      let tag = this.findTagByName(normalized);
      if (!tag) {
        const id = randomUUID();
        this.db
          .prepare(`INSERT INTO tags(id, name, created_at) VALUES (?, ?, ?)`)
          .run(id, normalized, now);
        tag = { id, name: normalized, createdAt: now };
      }

      this.db
        .prepare(`INSERT INTO task_tags(task_id, tag_id) VALUES (?, ?)`)
        .run(taskId, tag.id);
    }
  }

  private tagNamesForTask(taskId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT tg.name AS name
         FROM task_tags tt
         JOIN tags tg ON tg.id = tt.tag_id
         WHERE tt.task_id = ?
         ORDER BY tg.name COLLATE NOCASE`,
      )
      .all(taskId) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  private readOpen(query: string): SearchHit[] {
    let sql = `
      SELECT e.id AS entry_id, t.id AS task_id, t.name AS name, e.started_at AS started_at, e.expected_secs AS expected_secs
      FROM entries e
      JOIN tasks t ON t.id = e.task_id
      WHERE e.ended_at IS NULL`;
    const params: SqlParams = [];
    if (query.length > 0) {
      sql += ` AND t.name LIKE ? ESCAPE '\\'`;
      params.push(likeContains(query));
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      entry_id: string;
      task_id: string;
      name: string;
      started_at: number;
      expected_secs: number | null;
    }>;

    return rows.map((row) => ({
      kind: 'open_entry' as const,
      taskId: row.task_id,
      name: row.name,
      entryId: row.entry_id,
      startedAt: row.started_at,
      expectedSecs: row.expected_secs,
    }));
  }

  private readTasks(query: string): SearchHit[] {
    let sql = `
      SELECT t.id AS task_id, t.name AS name, t.expected_secs AS expected_secs, MAX(e.started_at) AS started_at
      FROM tasks t
      LEFT JOIN entries e ON e.task_id = t.id`;
    const params: SqlParams = [];
    if (query.length > 0) {
      sql += ` WHERE t.name LIKE ? ESCAPE '\\'`;
      params.push(likeContains(query));
    }
    sql += ` GROUP BY t.id`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      task_id: string;
      name: string;
      expected_secs: number | null;
      started_at: number | null;
    }>;

    return rows.map((row) => ({
      kind: 'task' as const,
      taskId: row.task_id,
      name: row.name,
      entryId: null,
      startedAt: row.started_at,
      expectedSecs: row.expected_secs,
    }));
  }

  private readEntry(id: string): EntryRecord | null {
    const rows = this.readEntryList(
      `SELECT e.id, e.task_id, t.name, e.started_at, e.ended_at, e.expected_secs, e.notes
       FROM entries e
       JOIN tasks t ON t.id = e.task_id
       WHERE e.id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  private readEntryList(sql: string, params: SqlParams = []): EntryRecord[] {
    const rows = this.db.prepare(sql).all(...params) as EntryRow[];
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      name: row.name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      expectedSecs: row.expected_secs,
      notes: row.notes,
    }));
  }
}

function rankName(name: string, query: string): number {
  const lower = name.toLowerCase();
  const q = query.toLowerCase();
  if (lower.startsWith(q)) {
    return 0;
  }

  if (lower.includes(q)) {
    return 1;
  }

  return 2;
}

function likeContains(query: string): string {
  return `%${escapeLike(query)}%`;
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
