/**
 * Browser-safe re-exports from @personal-logger/domain.
 * Avoid the package root (it pulls node:sqlite / migrate tooling).
 */
export {
  actualSeconds,
  entryIsOpen,
  minutesToSecs,
  secsToMinutes,
  type EntryRecord,
  type TaskRecord,
  type TaskRollup,
} from '../../../../packages/domain/src/models';
export {
  formatDuration,
  formatSignedDuration,
} from '../../../../packages/domain/src/duration';
export {
  computeRollups,
  habitDays,
  localDayKey as domainLocalDayKey,
} from '../../../../packages/domain/src/journal';
export { normalizeName, normalizeTagName } from '../../../../packages/domain/src/normalize';
export type { LogRepository } from '../../../../packages/domain/src/repository';
