export {
  actualSeconds,
  entryIsOpen,
  minutesToSecs,
  secsToMinutes,
  type Clock,
  type DayMark,
  type EntryRecord,
  type ExpectedTarget,
  type HitKind,
  type JournalSnapshot,
  type JournalWindow,
  type SearchHit,
  type TagRecord,
  type TaskRecord,
  type TaskRollup,
} from './models.js';

export {
  formatDuration,
  formatSignedDuration,
  tryParseDuration,
} from './duration.js';

export { normalizeName, normalizeTagName, requireName } from './normalize.js';

export {
  computeRollups,
  dayOverlapSecs,
  filterEntriesByFromMs,
  habitDays,
  journalWindowFromMs,
  localDayKey,
  localDayStartMs,
} from './journal.js';

export type { LogRepository } from './repository.js';

export {
  applyMigrations,
  MIGRATIONS,
  MIGRATION_V1_SQL,
  SCHEMA_VERSION,
  type MigrationStep,
  type SqlExecutor,
} from './migrations/index.js';

export { SqliteLogStore, type SqliteLogStoreOptions } from './sqlite-store.js';

export {
  legacyDbCandidatePaths,
  maybeMigrateOnFirstLaunch,
  migrateLegacyDatabase,
  type LegacySpanRow,
  type LegacyTaskRow,
  type MigrateLegacyOptions,
  type MigrationReport,
} from './migrate-legacy.js';
