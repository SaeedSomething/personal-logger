const UNIT_PATTERN = /(\d+(?:\.\d+)?)([dhm])/g;

/** Format whole seconds for display (matches .NET DurationText.Format). */
export function formatDuration(seconds: number): string {
  let secs = seconds;
  if (secs < 0) {
    secs = 0;
  }

  if (secs < 60) {
    return '<1m';
  }

  const days = Math.floor(secs / 86_400);
  const hours = Math.floor((secs % 86_400) / 3_600);
  const minutes = Math.floor((secs % 3_600) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

/** Signed delta display (matches .NET DurationText.FormatSigned; uses U+2212 minus). */
export function formatSignedDuration(seconds: number): string {
  if (Math.abs(seconds) < 60) {
    return '0m';
  }

  return seconds > 0 ? `+${formatDuration(seconds)}` : `−${formatDuration(-seconds)}`;
}

/**
 * Parse estimate text into seconds.
 * Accepts unit forms (`90m`, `2h30m`, `1d 4h`) or bare minutes (`15`, `1.5`).
 */
export function tryParseDuration(text: string | null | undefined): number | null {
  if (text == null || text.trim() === '') {
    return null;
  }

  const cleaned = text.trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  if (cleaned.length === 0) {
    return null;
  }

  const matches = [...cleaned.matchAll(UNIT_PATTERN)];
  if (matches.length > 0 && matches.map((m) => m[0]).join('') === cleaned) {
    let total = 0;
    for (const match of matches) {
      const amount = Number(match[1]);
      if (!Number.isFinite(amount) || amount < 0) {
        return null;
      }

      const unit = match[2];
      total +=
        unit === 'd'
          ? Math.round(amount * 86_400)
          : unit === 'h'
            ? Math.round(amount * 3_600)
            : Math.round(amount * 60);
    }

    if (total <= 0) {
      return null;
    }

    return total;
  }

  const minutes = Number(cleaned);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }

  const seconds = Math.round(minutes * 60);
  return seconds > 0 ? seconds : null;
}
