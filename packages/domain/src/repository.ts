import type {
  EntryRecord,
  ExpectedTarget,
  JournalSnapshot,
  JournalWindow,
  SearchHit,
  TagRecord,
  TaskRecord,
} from './models.js';

/**
 * Persistence boundary used by UI / platform adapters.
 * No React imports; seconds internally; open entry = endedAt === null.
 */
export interface LogRepository {
  search(query?: string | null): SearchHit[];

  /** Start a new open entry; multi-open allowed. Snapshots task expected_secs onto the entry. */
  start(
    name: string,
    options?: {
      notes?: string;
      tagNames?: string[];
    },
  ): EntryRecord;

  end(entryId: string): EntryRecord;

  setExpected(target: ExpectedTarget, seconds: number): void;

  loadJournal(options?: {
    window?: JournalWindow;
    fromMs?: number | null;
    focusName?: string | null;
    timeZone?: string;
  }): JournalSnapshot;

  getTask(taskId: string): TaskRecord | null;

  listTags(): TagRecord[];

  ensureTag(name: string): TagRecord;

  setTaskTags(taskId: string, tagNames: string[]): void;

  setTaskNotes(taskId: string, notes: string): void;

  setEntryNotes(entryId: string, notes: string): void;

  /** Cascade: deleting a task removes its entries and tag links. */
  deleteTask(taskId: string): void;

  /** Entry delete leaves the task. */
  deleteEntry(entryId: string): void;

  close(): void;
}
