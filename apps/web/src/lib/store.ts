/**
 * Thin persistence boundary for the web UI.
 * MemoryLoggerStore is the default until Tauri SQL plugs in the same interface.
 */
import {
  minutesToSecs,
  normalizeName,
  normalizeTagName,
  secsToMinutes,
  type LogRepository,
} from './domain';
import type { Entry, Task } from './types';

export type CreateTaskInput = {
  title: string;
  /** Expected duration in minutes (UI). */
  estimateMinutes: number;
  tags: string[];
  notes?: string;
};

export type LoggerStoreSnapshot = {
  tasks: Task[];
  entries: Entry[];
  tags: string[];
};

export type LoggerStoreListener = (snapshot: LoggerStoreSnapshot) => void;

/**
 * UI-facing store. Mirrors LogRepository semantics (multi-open, cascade delete)
 * with minute-oriented view models. A future TauriSqlLoggerStore can implement
 * this and/or adapt domain LogRepository.
 */
export interface LoggerStore {
  getSnapshot(): LoggerStoreSnapshot;
  subscribe(listener: LoggerStoreListener): () => void;

  ensureTag(name: string): string;
  createTask(input: CreateTaskInput): Task;
  /** Start does not end other open entries (multi-open). */
  startTask(taskId: string): Entry;
  endEntry(entryId: string): Entry;
  updateTask(
    taskId: string,
    patch: { title: string; notes: string; tags: string[] },
  ): Task;
  updateEntryNotes(entryId: string, notes: string): Entry;
  /** Cascade: removes task and all of its entries. */
  deleteTask(taskId: string): void;
  /** Leaves the task definition. */
  deleteEntry(entryId: string): void;
}

function newId(): string {
  return crypto.randomUUID();
}

export class MemoryLoggerStore implements LoggerStore {
  private tasks: Task[];
  private entries: Entry[];
  private tags: string[];
  private readonly listeners = new Set<LoggerStoreListener>();

  constructor(seed?: Partial<LoggerStoreSnapshot>) {
    this.tasks = seed?.tasks ? [...seed.tasks] : [];
    this.entries = seed?.entries ? [...seed.entries] : [];
    this.tags = seed?.tags ? [...seed.tags] : [];
  }

  getSnapshot(): LoggerStoreSnapshot {
    return {
      tasks: this.tasks.map((t) => ({ ...t, tags: [...t.tags] })),
      entries: this.entries.map((e) => ({ ...e })),
      tags: [...this.tags],
    };
  }

  subscribe(listener: LoggerStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  ensureTag(name: string): string {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed) return '';
    const clean = normalizeTagName(trimmed);
    if (!this.tags.includes(clean)) {
      this.tags = [...this.tags, clean];
      this.emit();
    }
    return clean;
  }

  createTask(input: CreateTaskInput): Task {
    const title = normalizeName(input.title);
    if (!title) throw new Error('Task title is required.');
    const tags = input.tags.map((t) => this.ensureTag(t)).filter(Boolean);
    const task: Task = {
      id: newId(),
      title,
      estimate: input.estimateMinutes,
      notes: input.notes ?? '',
      tags,
    };
    this.tasks = [task, ...this.tasks];
    this.emit();
    return task;
  }

  startTask(taskId: string): Entry {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    const entry: Entry = {
      id: newId(),
      taskId: task.id,
      startedAt: new Date().toISOString(),
      endedAt: null,
      expected: task.estimate,
      notes: '',
    };
    this.entries = [entry, ...this.entries];
    this.emit();
    return entry;
  }

  endEntry(entryId: string): Entry {
    const index = this.entries.findIndex((e) => e.id === entryId);
    if (index < 0) throw new Error(`Unknown entry: ${entryId}`);
    const current = this.entries[index]!;
    if (current.endedAt) return current;
    const ended: Entry = { ...current, endedAt: new Date().toISOString() };
    this.entries = this.entries.map((e) => (e.id === entryId ? ended : e));
    this.emit();
    return ended;
  }

  updateTask(
    taskId: string,
    patch: { title: string; notes: string; tags: string[] },
  ): Task {
    const title = normalizeName(patch.title);
    if (!title) throw new Error('Task title is required.');
    const tags = patch.tags.map((t) => this.ensureTag(t)).filter(Boolean);
    let updated: Task | null = null;
    this.tasks = this.tasks.map((task) => {
      if (task.id !== taskId) return task;
      updated = { ...task, title, notes: patch.notes, tags };
      return updated;
    });
    if (!updated) throw new Error(`Unknown task: ${taskId}`);
    this.emit();
    return updated;
  }

  updateEntryNotes(entryId: string, notes: string): Entry {
    let updated: Entry | null = null;
    this.entries = this.entries.map((entry) => {
      if (entry.id !== entryId) return entry;
      updated = { ...entry, notes };
      return updated;
    });
    if (!updated) throw new Error(`Unknown entry: ${entryId}`);
    this.emit();
    return updated;
  }

  deleteTask(taskId: string): void {
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    this.entries = this.entries.filter((e) => e.taskId !== taskId);
    this.emit();
  }

  deleteEntry(entryId: string): void {
    this.entries = this.entries.filter((e) => e.id !== entryId);
    this.emit();
  }
}

/** Map UI Entry → domain EntryRecord (seconds). */
export function toEntryRecord(entry: Entry, taskTitle: string) {
  return {
    id: entry.id,
    taskId: entry.taskId,
    name: taskTitle,
    startedAt: new Date(entry.startedAt).getTime(),
    endedAt: entry.endedAt ? new Date(entry.endedAt).getTime() : null,
    expectedSecs: minutesToSecs(entry.expected),
    notes: entry.notes,
  };
}

/** Adapter stub: wrap a domain LogRepository once Tauri SQL is ready. */
export function adaptLogRepository(repo: LogRepository): never {
  void repo;
  throw new Error('Tauri SQL LogRepository adapter not wired yet; use MemoryLoggerStore.');
}

export { secsToMinutes, minutesToSecs };
