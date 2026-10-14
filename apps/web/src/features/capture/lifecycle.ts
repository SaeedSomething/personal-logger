import type { Entry, LifecycleState, Task } from '../../lib/types';

/** Task definition with no open entry → prepared (standby). */
export function taskLifecycle(
  task: Task,
  entries: readonly Entry[],
): LifecycleState {
  const open = entries.some((e) => e.taskId === task.id && e.endedAt == null);
  if (open) return 'running';
  const completed = entries.some((e) => e.taskId === task.id && e.endedAt != null);
  return completed ? 'completed' : 'prepared';
}

export function entryLifecycle(entry: Entry): LifecycleState {
  return entry.endedAt == null ? 'running' : 'completed';
}

/** Start must not close other open entries. */
export function canStartWhileOthersOpen(openCount: number): boolean {
  return openCount >= 0;
}

export function openEntries(entries: readonly Entry[]): Entry[] {
  return entries.filter((e) => e.endedAt == null);
}

export function simulateLifecycleFlow(options: {
  createPrepared: () => string;
  start: (taskId: string) => string;
  startSecond: (taskId: string) => string;
  end: (entryId: string) => void;
  getOpenIds: () => string[];
}): { firstOpen: string; secondOpen: string; afterEndOpen: string[] } {
  const taskA = options.createPrepared();
  const taskB = options.createPrepared();
  const firstOpen = options.start(taskA);
  const secondOpen = options.startSecond(taskB);
  const both = options.getOpenIds();
  if (!both.includes(firstOpen) || !both.includes(secondOpen)) {
    throw new Error('Multi-open failed: both entries should be open.');
  }
  options.end(firstOpen);
  const afterEndOpen = options.getOpenIds();
  if (afterEndOpen.includes(firstOpen) || !afterEndOpen.includes(secondOpen)) {
    throw new Error('End one should leave the other running.');
  }
  return { firstOpen, secondOpen, afterEndOpen };
}
