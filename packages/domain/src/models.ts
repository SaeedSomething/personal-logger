/** Hit kinds for capture search results. */
export type HitKind = 'open_entry' | 'task';

export type SearchHit = {
  kind: HitKind;
  taskId: string;
  name: string;
  entryId: string | null;
  startedAt: number | null;
  expectedSecs: number | null;
};

/** One execution of a task (open when endedAt is null). */
export type EntryRecord = {
  id: string;
  taskId: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  expectedSecs: number | null;
  notes: string;
};

export type TaskRecord = {
  id: string;
  name: string;
  expectedSecs: number | null;
  notes: string;
  createdAt: number;
  tagNames: string[];
};

export type TagRecord = {
  id: string;
  name: string;
  createdAt: number;
};

export type ExpectedTarget =
  | { type: 'task'; taskId: string }
  | { type: 'entry'; entryId: string }
  | { type: 'name'; name: string };

export type TaskRollup = {
  taskId: string;
  name: string;
  entryCount: number;
  actualSecs: number;
  expectedSecs: number;
  openCount: number;
  estimatedCount: number;
  /** actual − expected over estimated entries' contribution; uses full actual vs sum expected. */
  deltaSecs: number;
};

export type DayMark = {
  /** Local calendar day as YYYY-MM-DD in the journal timezone. */
  day: string;
  active: boolean;
  actualSecs: number;
};

export type JournalWindow = '7d' | '30d' | 'all';

export type JournalSnapshot = {
  openEntries: EntryRecord[];
  entries: EntryRecord[];
  tasks: TaskRollup[];
  days: DayMark[];
  window: JournalWindow;
  fromMs: number | null;
};

export type Clock = {
  nowMs(): number;
};

export function entryIsOpen(entry: Pick<EntryRecord, 'endedAt'>): boolean {
  return entry.endedAt == null;
}

/** Elapsed wall time in whole seconds (matches .NET SpanRecord.ActualSeconds). */
export function actualSeconds(
  entry: Pick<EntryRecord, 'startedAt' | 'endedAt'>,
  nowMs: number,
): number {
  const end = entry.endedAt ?? nowMs;
  const elapsed = Math.max(0, end - entry.startedAt);
  return Math.floor(elapsed / 1000);
}

export function minutesToSecs(minutes: number): number {
  return Math.round(minutes * 60);
}

export function secsToMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}
