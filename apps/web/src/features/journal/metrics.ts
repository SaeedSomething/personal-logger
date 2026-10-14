import { computeRollups, secsToMinutes } from '../../lib/domain';
import { toEntryRecord } from '../../lib/store';
import {
  deltaMinutes,
  durationMinutes,
  localDayKey,
  type Entry,
  type Task,
  type WindowKey,
} from '../../lib/types';

export type TaskGroup = {
  task: Task;
  entries: Entry[];
  total: number;
  average: number;
  expected: number;
  delta: number;
  days: number;
};

export function windowCutoffMs(windowKey: WindowKey, now = Date.now()): number | null {
  if (windowKey === 'all') return null;
  const days = windowKey === '7d' ? 7 : windowKey === '30d' ? 30 : 365;
  return now - days * 86_400_000;
}

export function filterJournalEntries(
  entries: Entry[],
  tasks: Task[],
  options: {
    windowKey: WindowKey;
    query: string;
    tag: string;
    now?: number;
  },
): Entry[] {
  const minDate = windowCutoffMs(options.windowKey, options.now);
  const q = options.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (minDate != null && new Date(entry.startedAt).getTime() < minDate) return false;
    const task = tasks.find((item) => item.id === entry.taskId);
    const matchesText =
      !q ||
      task?.title.toLowerCase().includes(q) ||
      entry.notes.toLowerCase().includes(q);
    const matchesTag = options.tag === 'all' || !!task?.tags.includes(options.tag);
    return matchesText && matchesTag;
  });
}

export function groupByTask(
  journalEntries: Entry[],
  tasks: Task[],
  sortBy: 'recent' | 'name' | 'tag',
  now = Date.now(),
): TaskGroup[] {
  const titleById = new Map(tasks.map((t) => [t.id, t.title]));
  const records = journalEntries.map((entry) =>
    toEntryRecord(entry, titleById.get(entry.taskId) ?? 'Unknown task'),
  );
  const rollups = computeRollups(records, now);
  const rollupByTask = new Map(rollups.map((r) => [r.taskId, r]));

  const groups = new Map<string, Entry[]>();
  for (const entry of journalEntries) {
    groups.set(entry.taskId, [...(groups.get(entry.taskId) ?? []), entry]);
  }

  return Array.from(groups.entries())
    .map(([taskId, taskEntries]) => {
      const task =
        tasks.find((item) => item.id === taskId) ?? {
          id: taskId,
          title: 'Unknown task',
          estimate: 30,
          notes: '',
          tags: [] as string[],
        };
      const rollup = rollupByTask.get(taskId);
      const total = rollup
        ? secsToMinutes(rollup.actualSecs)
        : taskEntries.reduce((sum, entry) => sum + durationMinutes(entry, now), 0);
      const expected = rollup
        ? secsToMinutes(rollup.expectedSecs)
        : taskEntries.reduce((sum, entry) => sum + entry.expected, 0);
      const average = Math.round(total / taskEntries.length);
      const days = new Set(taskEntries.map((entry) => localDayKey(entry.startedAt))).size;
      return {
        task,
        entries: taskEntries,
        total,
        average,
        expected,
        delta: rollup ? secsToMinutes(rollup.deltaSecs) : deltaMinutes(total, expected),
        days,
      };
    })
    .sort((a, b) =>
      sortBy === 'name'
        ? a.task.title.localeCompare(b.task.title)
        : sortBy === 'tag'
          ? (a.task.tags[0] ?? '').localeCompare(b.task.tags[0] ?? '')
          : b.entries[0]!.startedAt.localeCompare(a.entries[0]!.startedAt),
    );
}

export function consistencyCells(
  taskEntries: Entry[],
  now = Date.now(),
): Array<{ day: string; count: number; label: string }> {
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return Array.from({ length: 7 }, (_, index) => {
    const targetMs = now - (6 - index) * 86_400_000;
    const day = localDayKey(targetMs);
    const count = taskEntries.filter((entry) => localDayKey(entry.startedAt) === day).length;
    return { day, count, label: labels[index]! };
  });
}

export function aggregateSelected(entries: Entry[], now = Date.now()) {
  const actual = entries.reduce((sum, entry) => sum + durationMinutes(entry, now), 0);
  const expected = entries.reduce((sum, entry) => sum + entry.expected, 0);
  const sessions = entries.length;
  const average = sessions === 0 ? 0 : Math.round(actual / sessions);
  return {
    sessions,
    /** Cumulative actual for the selection. */
    actual,
    cumulative: actual,
    expected,
    average,
    delta: deltaMinutes(actual, expected),
  };
}
