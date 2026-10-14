import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  migrateLegacyDatabase,
  maybeMigrateOnFirstLaunch,
} from '../migrate-legacy.js';
import { SqliteLogStore } from '../sqlite-store.js';
import { ManualClock } from './manual-clock.js';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function buildLegacyFixture(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      expected_secs INTEGER NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE spans (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      started_at INTEGER NOT NULL,
      ended_at INTEGER NULL,
      expected_secs INTEGER NULL
    );
  `);
  db.prepare(
    `INSERT INTO tasks (id, name, expected_secs, created_at) VALUES (?, ?, ?, ?)`,
  ).run(1, 'Running', 1800, 1_700_000_000_000);
  db.prepare(
    `INSERT INTO tasks (id, name, expected_secs, created_at) VALUES (?, ?, ?, ?)`,
  ).run(2, 'Laundry', 900, 1_700_000_100_000);
  db.prepare(
    `INSERT INTO spans (id, task_id, started_at, ended_at, expected_secs) VALUES (?, ?, ?, ?, ?)`,
  ).run(10, 1, 1_700_000_200_000, null, 1800);
  db.prepare(
    `INSERT INTO spans (id, task_id, started_at, ended_at, expected_secs) VALUES (?, ?, ?, ?, ?)`,
  ).run(11, 1, 1_700_000_300_000, null, 1800);
  db.prepare(
    `INSERT INTO spans (id, task_id, started_at, ended_at, expected_secs) VALUES (?, ?, ?, ?, ?)`,
  ).run(12, 2, 1_700_000_150_000, 1_700_000_180_000, 900);
  db.close();
}

describe('migrateLegacyDatabase', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('imports ≥2 tasks and multi-open spans; leaves original hash unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-migrate-'));
    temps.push(dir);
    const source = join(dir, 'logger.db');
    const target = join(dir, 'new.db');
    buildLegacyFixture(source);
    const before = sha256(source);

    let n = 0;
    const report = migrateLegacyDatabase({
      sourcePath: source,
      targetPath: target,
      workDir: dir,
      newId: () => `id-${++n}`,
    });

    expect(report.tasksImported).toBe(2);
    expect(report.spansImported).toBe(3);
    expect(report.openSpansImported).toBe(2);
    expect(sha256(source)).toBe(before);
    expect(report.originalSha256).toBe(before);

    const clock = new ManualClock(1_700_000_400_000);
    const store = new SqliteLogStore({ path: target, clock });
    try {
      const open = store.search(null).filter((hit) => hit.kind === 'open_entry');
      expect(open).toHaveLength(2);
      expect(open.every((hit) => hit.name === 'Running')).toBe(true);

      const journal = store.loadJournal({ window: 'all' });
      expect(journal.entries).toHaveLength(3);
      expect(journal.tasks).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  it('refuses to import into a non-empty target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-migrate-full-'));
    temps.push(dir);
    const source = join(dir, 'logger.db');
    const target = join(dir, 'new.db');
    buildLegacyFixture(source);
    const clock = new ManualClock(1);
    const store = new SqliteLogStore({ path: target, clock });
    store.start('Already here');
    store.close();

    expect(() =>
      migrateLegacyDatabase({ sourcePath: source, targetPath: target, workDir: dir }),
    ).toThrow(/not empty/i);
  });

  it('maybeMigrateOnFirstLaunch finds LOCALAPPDATA candidate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-first-'));
    temps.push(dir);
    const legacyHome = join(dir, 'personal-logger');
    mkdirSync(legacyHome, { recursive: true });
    const source = join(legacyHome, 'logger.db');
    buildLegacyFixture(source);
    const target = join(dir, 'app.db');

    let i = 0;
    const report = maybeMigrateOnFirstLaunch({
      targetPath: target,
      env: { LOCALAPPDATA: dir },
      newId: () => `m-${++i}`,
    });

    expect(report?.tasksImported).toBe(2);
    expect(report?.spansImported).toBe(3);
  });
});
