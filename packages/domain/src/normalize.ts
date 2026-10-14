const MAX_NAME_LENGTH = 80;

/** Collapse whitespace; empty string when blank (matches SqliteLogStore.Normalize). */
export function normalizeName(name: string | null | undefined): string {
  if (name == null || name.trim() === '') {
    return '';
  }

  return name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(' ');
}

/** Require a non-empty normalized name under 80 characters. */
export function requireName(name: string): string {
  const normalized = normalizeName(name);
  if (normalized.length === 0) {
    throw new Error('A task needs a name.');
  }

  if (normalized.length > MAX_NAME_LENGTH) {
    throw new Error('Keep the name under 80 characters.');
  }

  return normalized;
}

export function normalizeTagName(name: string): string {
  const normalized = normalizeName(name).toLowerCase();
  if (normalized.length === 0) {
    throw new Error('A tag needs a name.');
  }

  if (normalized.length > MAX_NAME_LENGTH) {
    throw new Error('Keep the tag under 80 characters.');
  }

  return normalized;
}
