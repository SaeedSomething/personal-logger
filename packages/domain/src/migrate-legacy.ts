import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrations/index.js';
import { normalizeName } from './normalize.js';

/** Legacy .NET schema: integer task/span ids, spans table (not entries). */
export type LegacyTaskRow = {
  id: number;
  name: string;
  expected_secs: number | null;
  created_at: number;
};

export type LegacySpanRow = {
  id: number;
  task_id: number;
  started_at: number;
  ended_at: number | null;
  expected_secs: number | null;
};

export type MigrationReport = {
  sourcePath: string;
  workingCopyPath: string;
  originalSha256: string;
  originalBytes: number;
  tasksImported: number;
  spansImported: number;
  openSpansImported: number;
  skippedEmptyNames: number;
  taskIdMap: Record<string, string>;
  spanIdMap: Record<string, string>;
};

export type MigrateLegacyOptions = {
  /** Absolute path to the original legacy logger.db (left untouched). */
  sourcePath: string;
  /** Destination v1 SQLite path (must be empty / not yet migrated, or empty new DB). */
  targetPath: string;
  /** Directory for the working copy; defaults beside target. */
  workDir?: string;
  /** Inject UUIDs for tests. */
  newId?: () => string;
};

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function openLegacyReadOnly(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true });
  return db;
}

function assertLegacySchema(db: DatabaseSync): void {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'spans') ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  const names = new Set(tables.map((row) => row.name));
  if (!names.has('tasks') || !names.has('spans')) {
    throw new Error(
      'Unexpected legacy schema: expected tasks and spans tables from SqliteLogStore.Migrate().',
    );
  }
}

/**
 * One-way import from .NET logger.db (tasks/spans) into schema v1 (tasks/entries).
 * Copies the source first; never writes to the original file.
 */
export function migrateLegacyDatabase(options: MigrateLegacyOptions): MigrationReport {
  const { sourcePath, targetPath } = options;
  if (!existsSync(sourcePath)) {
    throw new Error(`Legacy database not found: ${sourcePath}`);
  }

  const originalBytes = statSync(sourcePath).size;
  const originalSha256 = sha256File(sourcePath);
  const workDir = options.workDir ?? dirname(targetPath);
  const workingCopyPath = join(workDir, `legacy-import-${Date.now()}.db`);
  copyFileSync(sourcePath, workingCopyPath);

  const newId = options.newId ?? (() => randomUUID());
  const legacy = openLegacyReadOnly(workingCopyPath);
  try {
    assertLegacySchema(legacy);

    const target = new DatabaseSync(targetPath);
    try {
      applyMigrations({
        exec: (sql) => target.exec(sql),
        prepare: (sql) => ({
          get: (...params) =>
            target.prepare(sql).get(...params) as Record<string, unknown> | undefined,
        }),
      });

      const existingTasks = Number(
        (target.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c,
      );
      const existingEntries = Number(
        (target.prepare('SELECT COUNT(*) AS c FROM entries').get() as { c: number }).c,
      );
      if (existingTasks > 0 || existingEntries > 0) {
        throw new Error('Target database is not empty; refusing to import.');
      }

      const tasks = legacy
        .prepare(
          `SELECT id, name, expected_secs, created_at FROM tasks ORDER BY id`,
        )
        .all() as LegacyTaskRow[];
      const spans = legacy
        .prepare(
          `SELECT id, task_id, started_at, ended_at, expected_secs FROM spans ORDER BY id`,
        )
        .all() as LegacySpanRow[];

      const taskIdMap = new Map<number, string>();
      const spanIdMap = new Map<number, string>();
      let skippedEmptyNames = 0;
      let tasksImported = 0;
      let spansImported = 0;
      let openSpansImported = 0;

      const insertTask = target.prepare(
        `INSERT INTO tasks (id, name, expected_secs, notes, created_at)
         VALUES (?, ?, ?, '', ?)`,
      );
      const insertEntry = target.prepare(
        `INSERT INTO entries (id, task_id, started_at, ended_at, expected_secs, notes)
         VALUES (?, ?, ?, ?, ?, '')`,
      );

      target.exec('BEGIN');
      try {
        for (const task of tasks) {
          const name = normalizeName(task.name);
          if (!name) {
            skippedEmptyNames += 1;
            continue;
          }

          const id = newId();
          taskIdMap.set(task.id, id);
          insertTask.run(id, name, task.expected_secs, task.created_at);
          tasksImported += 1;
        }

        for (const span of spans) {
          const taskUuid = taskIdMap.get(span.task_id);
          if (!taskUuid) {
            continue;
          }

          const id = newId();
          spanIdMap.set(span.id, id);
          insertEntry.run(
            id,
            taskUuid,
            span.started_at,
            span.ended_at,
            span.expected_secs,
          );
          spansImported += 1;
          if (span.ended_at == null) {
            openSpansImported += 1;
          }
        }

        target.exec('COMMIT');
      } catch (error) {
        target.exec('ROLLBACK');
        throw error;
      }

      const afterSha = sha256File(sourcePath);
      if (afterSha !== originalSha256) {
        throw new Error('Original legacy database bytes changed during import.');
      }

      return {
        sourcePath,
        workingCopyPath,
        originalSha256,
        originalBytes,
        tasksImported,
        spansImported,
        openSpansImported,
        skippedEmptyNames,
        taskIdMap: Object.fromEntries(
          [...taskIdMap.entries()].map(([k, v]) => [String(k), v]),
        ),
        spanIdMap: Object.fromEntries(
          [...spanIdMap.entries()].map(([k, v]) => [String(k), v]),
        ),
      };
    } finally {
      target.close();
    }
  } finally {
    legacy.close();
  }
}

/** Well-known Windows / Android legacy paths from the migration plan. */
export function legacyDbCandidatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const paths: string[] = [];
  const localAppData = env.LOCALAPPDATA;
  if (localAppData) {
    paths.push(join(localAppData, 'personal-logger', 'logger.db'));
  }
  // Android FilesDir is provided by the shell at runtime; include a conventional name for docs/tests.
  const androidFilesDir = env.PERSONAL_LOGGER_ANDROID_FILES_DIR;
  if (androidFilesDir) {
    paths.push(join(androidFilesDir, 'logger.db'));
  }
  return paths;
}

/**
 * Import on first launch when a legacy DB exists and the target is missing or empty.
 * Returns null when there is nothing to do.
 */
export function maybeMigrateOnFirstLaunch(options: {
  targetPath: string;
  env?: NodeJS.ProcessEnv;
  newId?: () => string;
}): MigrationReport | null {
  if (existsSync(options.targetPath)) {
    const probe = new DatabaseSync(options.targetPath);
    try {
      const tables = probe
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`,
        )
        .get() as { name?: string } | undefined;
      if (tables?.name) {
        const count = Number(
          (probe.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c,
        );
        if (count > 0) {
          return null;
        }
      }
    } finally {
      probe.close();
    }
  }

  for (const sourcePath of legacyDbCandidatePaths(options.env)) {
    if (!existsSync(sourcePath)) {
      continue;
    }
    return migrateLegacyDatabase({
      sourcePath,
      targetPath: options.targetPath,
      newId: options.newId,
    });
  }

  return null;
}
