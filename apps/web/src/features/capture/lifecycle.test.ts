import { describe, expect, it } from 'vitest';
import type { Entry, Task } from '../../lib/types';

/** Pure lifecycle helper mirroring App create/start/end without React. */
function createTask(
  tasks: Task[],
  entries: Entry[],
  input: { title: string; estimate: number; tags: string[]; startImmediately: boolean },
): { tasks: Task[]; entries: Entry[] } {
  const task: Task = {
    id: `task-${tasks.length + 1}`,
    title: input.title,
    estimate: input.estimate,
    notes: '',
    tags: input.tags,
  };
  let nextEntries = entries;
  if (input.startImmediately) {
    nextEntries = [
      {
        id: `entry-${entries.length + 1}`,
        taskId: task.id,
        startedAt: new Date(0).toISOString(),
        endedAt: null,
        expected: task.estimate,
        notes: '',
      },
      ...entries,
    ];
  }
  return { tasks: [task, ...tasks], entries: nextEntries };
}

function startTask(tasks: Task[], entries: Entry[], taskId: string): Entry[] {
  const task = tasks.find((t) => t.id === taskId)!;
  return [
    {
      id: `entry-${entries.length + 1}`,
      taskId: task.id,
      startedAt: new Date(1).toISOString(),
      endedAt: null,
      expected: task.estimate,
      notes: '',
    },
    ...entries,
  ];
}

function endEntry(entries: Entry[], entryId: string): Entry[] {
  return entries.map((entry) =>
    entry.id === entryId ? { ...entry, endedAt: new Date(2).toISOString() } : entry,
  );
}

describe('capture lifecycle', () => {
  it('create → standby (prepared) → start → second concurrent start → end one', () => {
    let tasks: Task[] = [];
    let entries: Entry[] = [];

    ({ tasks, entries } = createTask(tasks, entries, {
      title: 'Focus',
      estimate: 30,
      tags: ['work'],
      startImmediately: false,
    }));
    expect(entries.filter((e) => !e.endedAt)).toHaveLength(0);
    expect(tasks).toHaveLength(1);

    entries = startTask(tasks, entries, tasks[0]!.id);
    expect(entries.filter((e) => !e.endedAt)).toHaveLength(1);

    entries = startTask(tasks, entries, tasks[0]!.id);
    const open = entries.filter((e) => !e.endedAt);
    expect(open).toHaveLength(2);

    const firstOpen = open[1]!;
    entries = endEntry(entries, firstOpen.id);
    expect(entries.filter((e) => !e.endedAt)).toHaveLength(1);
    expect(entries.find((e) => e.id === firstOpen.id)?.endedAt).not.toBeNull();
  });
});
