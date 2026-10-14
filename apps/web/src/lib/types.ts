import { actualSeconds, formatDuration, formatSignedDuration, secsToMinutes } from './domain';
import type { Entry } from './types-core';

export type { Entry, LifecycleState, SortKey, Task, WindowKey } from './types-core';

/** Format whole minutes for UI via domain duration helpers. */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes === 0) return '0m';
  const secs = Math.round(minutes * 60);
  if (minutes < 0) return formatSignedDuration(secs);
  return formatDuration(Math.abs(secs));
}

export function durationMinutes(entry: Entry, now = Date.now()): number {
  return secsToMinutes(
    actualSeconds(
      {
        startedAt: new Date(entry.startedAt).getTime(),
        endedAt: entry.endedAt ? new Date(entry.endedAt).getTime() : null,
      },
      now,
    ),
  );
}

export function relativeDate(date: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(date));
}

/** Local calendar day key (avoids UTC dayKey skew). */
export function localDayKey(
  date: string | number,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(date));
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/** Delta convention: actual − expected (positive = over estimate). */
export function deltaMinutes(actual: number, expected: number): number {
  return actual - expected;
}
