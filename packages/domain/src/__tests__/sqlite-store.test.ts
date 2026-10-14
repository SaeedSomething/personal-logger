import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../migrations/index.js';
import { actualSeconds } from '../models.js';
import { SqliteLogStore } from '../sqlite-store.js';
import { ManualClock } from './manual-clock.js';

describe('SqliteLogStore', () => {
  const temps: string[] = [];
  const stores: SqliteLogStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function openStore(clock: ManualClock): SqliteLogStore {
    const dir = mkdtempSync(join(tmpdir(), 'personal-logger-domain-'));
    temps.push(dir);
    const store = new SqliteLogStore({ path: join(dir, 'logger.db'), clock });
    stores.push(store);
    return store;
  }

  it('keeps the first spelling and can reopen without closing (multi-open)', () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 1, 8, 0, 0));
    const store = openStore(clock);

    const first = store.start('Running');
    clock.advance(10 * 60_000);
    const second = store.start('  running ');

    expect(second.taskId).toBe(first.taskId);
    expect(second.name).toBe('Running');
    expect(second.id).not.toBe(first.id);

    const hits = store.search('runn');
    expect(hits.filter((hit) => hit.kind === 'open_entry')).toHaveLength(2);
    expect(hits.some((hit) => hit.kind === 'task' && hit.name === 'Running')).toBe(true);
  });

  it('ends only the chosen open entry', () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 1, 8, 0, 0));
    const store = openStore(clock);

    const first = store.start('laundry');
    const second = store.start('laundry');
    clock.advance(25 * 60_000);

    const closed = store.end(first.id);
    expect(closed.endedAt).not.toBeNull();

    const open = store.search(null).filter((hit) => hit.kind === 'open_entry');
    expect(open).toHaveLength(1);
    expect(open[0]?.entryId).toBe(second.id);
  });

  it('snapshots expected seconds onto the next start', () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 1, 8, 0, 0));
    const store = openStore(clock);

    const started = store.start('refactor');
    store.setExpected({ type: 'name', name: 'refactor' }, 3_600);
    clock.advance(5 * 60_000);
    const next = store.start('refactor');

    expect(started.expectedSecs).toBeNull();
    expect(next.expectedSecs).toBe(3_600);

    store.setExpected({ type: 'entry', entryId: next.id }, 1_800);
    const third = store.start('refactor');
    expect(third.expectedSecs).toBe(3_600);

    const journal = store.loadJournal({ focusName: 'refactor', timeZone: 'UTC' });
    const updated = journal.entries.find((entry) => entry.id === next.id);
    const original = journal.entries.find((entry) => entry.id === started.id);
    expect(updated?.expectedSecs).toBe(1_800);
    expect(original?.expectedSecs).toBeNull();
  });

  it('rollups compare actual time with the estimate', () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 1, 8, 0, 0));
    const store = openStore(clock);

    store.setExpected({ type: 'name', name: 'laundry' }, 30 * 60);
    const span = store.start('laundry');
    clock.advance(40 * 60_000);
    store.end(span.id);

    const journal = store.loadJournal({ focusName: 'laundry', timeZone: 'UTC' });
    expect(journal.tasks).toHaveLength(1);
    const task = journal.tasks[0]!;
    expect(task.actualSecs).toBe(40 * 60);
    expect(task.expectedSecs).toBe(30 * 60);
    expect(task.estimatedCount).toBe(1);
    expect(task.deltaSecs).toBe(10 * 60);

    const day = journal.days.find((mark) => mark.day === '2026-10-01');
    expect(day?.active).toBe(true);
    expect(day?.actualSecs).toBe(40 * 60);
  });

  it('lists open entries before recent names on empty search', () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 1, 8, 0, 0));
    const store = openStore(clock);

    store.start('laundry');
    clock.advance(60_000);
    const open = store.start('inbox');
    store.end(open.id);

    const hits = store.search('  ');
    expect(hits[0]?.kind).toBe('open_entry');
    expect(hits[0]?.name).toBe('laundry');
    expect(hits.some((hit) => hit.kind === 'task' && hit.name === 'inbox')).toBe(true);
  });

  it('supports tags and notes on tasks and entries', () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 1, 8, 0, 0));
    const store = openStore(clock);

    const entry = store.start('Deep work', {
      notes: 'first pass',
      tagNames: ['Focus', 'work'],
    });
    expect(entry.notes).toBe('first pass');

    const task = store.getTask(entry.taskId);
    expect(task?.tagNames).toEqual(['focus', 'work']);
    expect(store.listTags().map((tag) => tag.name)).toEqual(['focus', 'work']);

    store.setEntryNotes(entry.id, 'updated note');
    store.setTaskNotes(entry.taskId, 'task notes');
    store.setTaskTags(entry.taskId, ['health']);

    const refreshed = store.getTask(entry.taskId);
    expect(refreshed?.notes).toBe('task notes');
    expect(refreshed?.tagNames).toEqual(['health']);

    const journal = store.loadJournal({ focusName: 'Deep work' });
    expect(journal.entries[0]?.notes).toBe('updated note');
  });

  it('applies user_version schema migration', () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 1, 8, 0, 0));
    const dir = mkdtempSync(join(tmpdir(), 'personal-logger-domain-'));
    temps.push(dir);
    const path = join(dir, 'logger.db');
    const store = new SqliteLogStore({ path, clock });
    store.start('ping');
    store.close();

    // Re-open should be idempotent at SCHEMA_VERSION.
    const again = new SqliteLogStore({ path, clock });
    stores.push(again);
    again.close();
    stores.pop();

    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(row.user_version).toBe(SCHEMA_VERSION);
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks','tags','task_tags','entries') ORDER BY name`,
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toEqual(['entries', 'tags', 'task_tags', 'tasks']);
    } finally {
      db.close();
    }
  });
});

describe('actualSeconds', () => {
  it('uses endedAt when present and nowMs when open', () => {
    expect(
      actualSeconds({ startedAt: 1_000, endedAt: 5_000 }, 99_000),
    ).toBe(4);
    expect(
      actualSeconds({ startedAt: 1_000, endedAt: null }, 5_000),
    ).toBe(4);
  });
});
