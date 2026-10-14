import type { Entry, Task } from './types';

export const seedTasks: Task[] = [
  {
    id: 'task-1',
    title: 'Morning pages',
    estimate: 20,
    notes: 'A quiet start before the day gets noisy.',
    tags: ['focus'],
  },
  {
    id: 'task-2',
    title: 'Fixing form service',
    estimate: 45,
    notes: 'Review the validation path and close the loop.',
    tags: ['work'],
  },
  {
    id: 'task-3',
    title: 'Daily warmup',
    estimate: 30,
    notes: 'Mobility and a short walk.',
    tags: ['health'],
  },
  {
    id: 'task-4',
    title: 'Deep work block',
    estimate: 90,
    notes: 'The focused block that usually needs more runway.',
    tags: ['focus'],
  },
];

const now = Date.now();

export const seedEntries: Entry[] = [
  {
    id: 'entry-1',
    taskId: 'task-3',
    startedAt: new Date(now - 86_400_000 + 7 * 3_600_000).toISOString(),
    endedAt: new Date(now - 86_400_000 + 7 * 3_600_000 + 27 * 60_000).toISOString(),
    expected: 30,
    notes: 'Felt easy to start.',
  },
  {
    id: 'entry-2',
    taskId: 'task-1',
    startedAt: new Date(now - 2 * 86_400_000 + 9 * 3_600_000).toISOString(),
    endedAt: new Date(now - 2 * 86_400_000 + 9 * 3_600_000 + 18 * 60_000).toISOString(),
    expected: 20,
    notes: 'Good first pass.',
  },
  {
    id: 'entry-3',
    taskId: 'task-2',
    startedAt: new Date(now - 3 * 86_400_000 + 13 * 3_600_000).toISOString(),
    endedAt: new Date(now - 3 * 86_400_000 + 14 * 3_600_000 + 2 * 60_000).toISOString(),
    expected: 45,
    notes: 'The edge cases took longer.',
  },
  {
    id: 'entry-4',
    taskId: 'task-4',
    startedAt: new Date(now - 5 * 86_400_000 + 10 * 3_600_000).toISOString(),
    endedAt: new Date(now - 5 * 86_400_000 + 11 * 3_600_000 + 24 * 60_000).toISOString(),
    expected: 90,
    notes: 'One deep block with a short reset.',
  },
];

export const seedTags = ['work', 'health', 'home', 'focus'];
