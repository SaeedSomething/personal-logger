export type Task = {
  id: string;
  title: string;
  /** Expected duration in minutes (UI); domain stores seconds. */
  estimate: number;
  notes: string;
  tags: string[];
};

export type Entry = {
  id: string;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  /** Snapshot expected minutes at start. */
  expected: number;
  notes: string;
};

export type WindowKey = '7d' | '30d' | 'year' | 'all';

export type SortKey = 'recent' | 'name' | 'tag';

export type LifecycleState = 'prepared' | 'running' | 'completed';
