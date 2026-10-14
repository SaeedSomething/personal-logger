import { describe, expect, it } from 'vitest';
import type { Entry, Task } from '../../lib/types';
import { deltaMinutes } from '../../lib/types';
import {
  aggregateSelected,
  filterJournalEntries,
  groupByTask,
  windowCutoffMs,
} from './metrics';

const now = Date.UTC(2026, 9, 13, 12, 0, 0);

const tasks: Task[] = [
  { id: 't1', title: 'Deep work', estimate: 90, notes: '', tags: ['focus'] },
  { id: 't2', title: 'Walk', estimate: 30, notes: '', tags: ['health'] },
];

const entries: Entry[] = [
  {
    id: 'e1',
    taskId: 't1',
    startedAt: new Date(now - 2 * 86_400_000).toISOString(),
    endedAt: new Date(now - 2 * 86_400_000 + 100 * 60_000).toISOString(),
    expected: 90,
    notes: 'long',
  },
  {
    id: 'e2',
    taskId: 't2',
    startedAt: new Date(now - 40 * 86_400_000).toISOString(),
    endedAt: new Date(now - 40 * 86_400_000 + 25 * 60_000).toISOString(),
    expected: 30,
    notes: 'old',
  },
];

describe('journal metrics', () => {
  it('defines delta as actual − expected', () => {
    expect(deltaMinutes(100, 90)).toBe(10);
    expect(deltaMinutes(20, 30)).toBe(-10);
  });

  it('filters by window and tag', () => {
    const week = filterJournalEntries(entries, tasks, {
      windowKey: '7d',
      query: '',
      tag: 'all',
      now,
    });
    expect(week).toHaveLength(1);
    expect(week[0]!.id).toBe('e1');

    const focus = filterJournalEntries(entries, tasks, {
      windowKey: 'all',
      query: '',
      tag: 'focus',
      now,
    });
    expect(focus).toHaveLength(1);
  });

  it('year window is 365 days', () => {
    const cutoff = windowCutoffMs('year', now);
    expect(cutoff).toBe(now - 365 * 86_400_000);
  });

  it('aggregates selected sessions with delta', () => {
    const metrics = aggregateSelected(entries, now);
    expect(metrics.sessions).toBe(2);
    expect(metrics.actual).toBe(125);
    expect(metrics.expected).toBe(120);
    expect(metrics.delta).toBe(5);
  });

  it('groups by task with average and delta', () => {
    const groups = groupByTask(entries, tasks, 'name', now);
    const deep = groups.find((g) => g.task.id === 't1')!;
    expect(deep.total).toBe(100);
    expect(deep.average).toBe(100);
    expect(deep.delta).toBe(10);
  });
});
