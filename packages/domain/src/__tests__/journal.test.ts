import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeRollups,
  dayOverlapSecs,
  journalWindowFromMs,
  localDayKey,
} from '../journal.js';
import type { EntryRecord } from '../models.js';
import { SqliteLogStore } from '../sqlite-store.js';
import { ManualClock } from './manual-clock.js';

describe('journalWindowFromMs', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);

  it('maps 7d / 30d / all', () => {
    expect(journalWindowFromMs('7d', now)).toBe(now - 7 * 86_400_000);
    expect(journalWindowFromMs('30d', now)).toBe(now - 30 * 86_400_000);
    expect(journalWindowFromMs('all', now)).toBeNull();
  });
});

describe('journal aggregates 7d / 30d / all', () => {
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

  it('filters rollups by window', () => {
    const now = Date.UTC(2026, 9, 10, 12, 0, 0);
    const clock = new ManualClock(now);
    const dir = mkdtempSync(join(tmpdir(), 'personal-logger-domain-'));
    temps.push(dir);
    const store = new SqliteLogStore({ path: join(dir, 'logger.db'), clock });
    stores.push(store);

    // 3 days ago — inside 7d and 30d
    clock.set(now - 3 * 86_400_000);
    store.setExpected({ type: 'name', name: 'recent' }, 30 * 60);
    const recent = store.start('recent');
    clock.advance(20 * 60_000);
    store.end(recent.id);

    // 20 days ago — outside 7d, inside 30d
    clock.set(now - 20 * 86_400_000);
    store.setExpected({ type: 'name', name: 'monthly' }, 60 * 60);
    const monthly = store.start('monthly');
    clock.advance(45 * 60_000);
    store.end(monthly.id);

    // 60 days ago — only in all
    clock.set(now - 60 * 86_400_000);
    store.setExpected({ type: 'name', name: 'ancient' }, 15 * 60);
    const ancient = store.start('ancient');
    clock.advance(10 * 60_000);
    store.end(ancient.id);

    clock.set(now);

    const week = store.loadJournal({ window: '7d', timeZone: 'UTC' });
    expect(week.tasks.map((t) => t.name).sort()).toEqual(['recent']);
    expect(week.tasks[0]?.actualSecs).toBe(20 * 60);
    expect(week.fromMs).toBe(journalWindowFromMs('7d', now));

    const month = store.loadJournal({ window: '30d', timeZone: 'UTC' });
    expect(month.tasks.map((t) => t.name).sort()).toEqual(['monthly', 'recent']);
    const monthActual = month.tasks.reduce((sum, t) => sum + t.actualSecs, 0);
    expect(monthActual).toBe(20 * 60 + 45 * 60);

    const all = store.loadJournal({ window: 'all', timeZone: 'UTC' });
    expect(all.tasks.map((t) => t.name).sort()).toEqual(['ancient', 'monthly', 'recent']);
    expect(all.fromMs).toBeNull();
    const allActual = all.tasks.reduce((sum, t) => sum + t.actualSecs, 0);
    expect(allActual).toBe(20 * 60 + 45 * 60 + 10 * 60);
  });
});

describe('midnight-crossing entries', () => {
  it('splits overlap seconds across local days', () => {
    // 23:00 UTC Oct 1 → 01:00 UTC Oct 2 = 2h, one hour each day in UTC.
    const startedAt = Date.UTC(2026, 9, 1, 23, 0, 0);
    const endedAt = Date.UTC(2026, 9, 2, 1, 0, 0);
    const day1Start = Date.UTC(2026, 9, 1, 0, 0, 0);
    const day1End = Date.UTC(2026, 9, 2, 0, 0, 0);
    const day2Start = day1End;
    const day2End = Date.UTC(2026, 9, 3, 0, 0, 0);

    const entry = { startedAt, endedAt };
    expect(dayOverlapSecs(entry, day1Start, day1End, endedAt)).toBe(3600);
    expect(dayOverlapSecs(entry, day2Start, day2End, endedAt)).toBe(3600);
  });

  it('habit days attribute midnight-crossing time to both days', () => {
    const clock = new ManualClock(Date.UTC(2026, 9, 2, 8, 0, 0));
    const dir = mkdtempSync(join(tmpdir(), 'personal-logger-domain-'));
    const store = new SqliteLogStore({ path: join(dir, 'logger.db'), clock });

    try {
      clock.set(Date.UTC(2026, 9, 1, 23, 0, 0));
      store.setExpected({ type: 'name', name: 'overnight' }, 2 * 3600);
      const entry = store.start('overnight');
      clock.set(Date.UTC(2026, 9, 2, 1, 0, 0));
      store.end(entry.id);
      clock.set(Date.UTC(2026, 9, 2, 8, 0, 0));

      const journal = store.loadJournal({
        focusName: 'overnight',
        timeZone: 'UTC',
        fromMs: Date.UTC(2026, 9, 1, 0, 0, 0),
      });

      const day1 = journal.days.find((d) => d.day === '2026-10-01');
      const day2 = journal.days.find((d) => d.day === '2026-10-02');
      expect(day1?.active).toBe(true);
      expect(day1?.actualSecs).toBe(3600);
      expect(day2?.active).toBe(true);
      expect(day2?.actualSecs).toBe(3600);
      expect(localDayKey(entry.startedAt, 'UTC')).toBe('2026-10-01');
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('computeRollups', () => {
  it('orders by actual descending then name', () => {
    const now = 10_000_000;
    const entries: EntryRecord[] = [
      {
        id: '1',
        taskId: 'a',
        name: 'beta',
        startedAt: 0,
        endedAt: 60_000,
        expectedSecs: 30,
        notes: '',
      },
      {
        id: '2',
        taskId: 'b',
        name: 'alpha',
        startedAt: 0,
        endedAt: 120_000,
        expectedSecs: 60,
        notes: '',
      },
    ];

    const rollups = computeRollups(entries, now);
    expect(rollups.map((r) => r.name)).toEqual(['alpha', 'beta']);
    expect(rollups[0]?.deltaSecs).toBe(120 - 60);
  });
});
