import {
  actualSeconds,
  type DayMark,
  type EntryRecord,
  type JournalWindow,
  type TaskRollup,
} from './models.js';

const MS_PER_DAY = 86_400_000;

/** Convert a journal window into a lower bound on started_at (ms), or null for all time. */
export function journalWindowFromMs(window: JournalWindow, nowMs: number): number | null {
  if (window === 'all') {
    return null;
  }

  const days = window === '7d' ? 7 : 30;
  return nowMs - days * MS_PER_DAY;
}

export function filterEntriesByFromMs(
  entries: readonly EntryRecord[],
  fromMs: number | null,
): EntryRecord[] {
  if (fromMs == null) {
    return [...entries];
  }

  return entries.filter((entry) => entry.startedAt >= fromMs);
}

export function computeRollups(
  entries: readonly EntryRecord[],
  nowMs: number,
): TaskRollup[] {
  const byTask = new Map<string, EntryRecord[]>();
  for (const entry of entries) {
    const list = byTask.get(entry.taskId);
    if (list) {
      list.push(entry);
    } else {
      byTask.set(entry.taskId, [entry]);
    }
  }

  const rollups: TaskRollup[] = [];
  for (const group of byTask.values()) {
    const estimated = group.filter((entry) => entry.expectedSecs != null);
    const actualSecs = group.reduce((sum, entry) => sum + actualSeconds(entry, nowMs), 0);
    const expectedSecs = estimated.reduce((sum, entry) => sum + (entry.expectedSecs ?? 0), 0);
    rollups.push({
      taskId: group[0]!.taskId,
      name: group[0]!.name,
      entryCount: group.length,
      actualSecs,
      expectedSecs,
      openCount: group.filter((entry) => entry.endedAt == null).length,
      estimatedCount: estimated.length,
      deltaSecs: actualSecs - expectedSecs,
    });
  }

  return rollups.sort((a, b) => {
    if (b.actualSecs !== a.actualSecs) {
      return b.actualSecs - a.actualSecs;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/** Local YYYY-MM-DD for a unix ms instant in an IANA timezone. */
export function localDayKey(unixMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(unixMs));

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error(`Could not format local day for ${unixMs} in ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

/**
 * Approximate local midnight as unix ms for YYYY-MM-DD in a timezone.
 * Uses binary search over UTC instants (handles DST offsets).
 */
export function localDayStartMs(dayKey: string, timeZone: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) {
    throw new Error(`Invalid day key: ${dayKey}`);
  }

  // Midday UTC guess near that calendar date, then walk to local midnight.
  let guess = Date.UTC(y, m - 1, d, 12, 0, 0);
  // Nudge until format matches dayKey at noon-ish, then find start.
  for (let i = 0; i < 3; i++) {
    const key = localDayKey(guess, timeZone);
    if (key === dayKey) {
      break;
    }

    const [ky, km, kd] = key.split('-').map(Number);
    const deltaDays =
      Date.UTC(y, m - 1, d) / MS_PER_DAY - Date.UTC(ky!, km! - 1, kd!) / MS_PER_DAY;
    guess += Math.round(deltaDays) * MS_PER_DAY;
  }

  // Binary search for first ms of the local day.
  let lo = guess - 36 * 3_600_000;
  let hi = guess + 36 * 3_600_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDayKey(mid, timeZone) < dayKey) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo;
}

function addLocalDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + days));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function compareDayKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Overlap of [startedAt, endedAt|now) with a local calendar day, in whole seconds.
 * Splits midnight-crossing entries across days (matches .NET HabitDays).
 */
export function dayOverlapSecs(
  entry: Pick<EntryRecord, 'startedAt' | 'endedAt'>,
  dayStartMs: number,
  dayEndMs: number,
  nowMs: number,
): number {
  const end = entry.endedAt ?? nowMs;
  const overlapStart = Math.max(entry.startedAt, dayStartMs);
  const overlapEnd = Math.min(end, dayEndMs);
  if (overlapEnd <= overlapStart) {
    return 0;
  }

  return Math.floor((overlapEnd - overlapStart) / 1000);
}

export function habitDays(options: {
  entries: readonly EntryRecord[];
  fromMs: number | null;
  nowMs: number;
  timeZone: string;
}): DayMark[] {
  const { entries, fromMs, nowMs, timeZone } = options;
  const today = localDayKey(nowMs, timeZone);
  let startDay = fromMs != null ? localDayKey(fromMs, timeZone) : addLocalDays(today, -41);
  if (compareDayKeys(startDay, today) > 0) {
    startDay = today;
  }

  // Cap window like .NET (>62 calendar days from start).
  let dayCount = 0;
  for (let d = startDay; compareDayKeys(d, today) <= 0; d = addLocalDays(d, 1)) {
    dayCount += 1;
  }
  if (dayCount > 63) {
    startDay = addLocalDays(today, -62);
  }

  const windowStart = localDayStartMs(startDay, timeZone);
  const windowEnd = localDayStartMs(addLocalDays(today, 1), timeZone);
  const relevant = entries.filter((entry) => {
    const end = entry.endedAt ?? nowMs;
    return entry.startedAt < windowEnd && end > windowStart;
  });

  const days: DayMark[] = [];
  for (let day = startDay; compareDayKeys(day, today) <= 0; day = addLocalDays(day, 1)) {
    const dayStart = localDayStartMs(day, timeZone);
    const dayEnd = localDayStartMs(addLocalDays(day, 1), timeZone);
    let actual = 0;
    for (const entry of relevant) {
      actual += dayOverlapSecs(entry, dayStart, dayEnd, nowMs);
    }

    days.push({ day, active: actual > 0, actualSecs: actual });
  }

  return days;
}
