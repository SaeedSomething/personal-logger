import { MIGRATION_V1_SQL, SCHEMA_VERSION } from './v1.sql.js';

export { MIGRATION_V1_SQL, SCHEMA_VERSION };

export type SqlExecutor = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: Array<null | number | bigint | string>): Record<string, unknown> | undefined;
  };
};

export type MigrationStep = {
  version: number;
  sql: string;
};

/** Ordered migrations applied when user_version is lower. */
export const MIGRATIONS: readonly MigrationStep[] = [
  { version: 1, sql: MIGRATION_V1_SQL },
];

/**
 * Apply pending schema migrations using SQLite user_version.
 * Returns the resulting schema version.
 */
export function applyMigrations(db: SqlExecutor): number {
  db.exec('PRAGMA foreign_keys = ON;');

  const row = db.prepare('PRAGMA user_version').get() as
    | { user_version?: number }
    | undefined;
  let current = Number(row?.user_version ?? 0);

  for (const step of MIGRATIONS) {
    if (step.version <= current) {
      continue;
    }

    // No wrapping transaction: migrations may include PRAGMAs (e.g. journal_mode)
    // that cannot run inside an explicit transaction.
    db.exec(step.sql);
    // user_version must be a literal integer in PRAGMA.
    db.exec(`PRAGMA user_version = ${step.version};`);
    current = step.version;
  }

  if (current < SCHEMA_VERSION) {
    throw new Error(
      `Schema migration stalled at user_version=${current}; expected ${SCHEMA_VERSION}.`,
    );
  }

  return current;
}
