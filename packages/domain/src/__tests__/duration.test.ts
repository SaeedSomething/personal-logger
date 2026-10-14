import { describe, expect, it } from 'vitest';
import { formatDuration, formatSignedDuration, tryParseDuration } from '../duration.js';

describe('tryParseDuration', () => {
  it.each([
    ['90m', 5_400],
    ['2h30m', 9_000],
    ['1d', 86_400],
    ['1d 4h', 100_800],
    ['15', 900],
    ['1.5h', 5_400],
    ['2h', 7_200],
  ])('parses %s as %d seconds', (text, seconds) => {
    expect(tryParseDuration(text)).toBe(seconds);
  });

  it.each(['', '0', '-5', '1x'])('rejects %s', (text) => {
    expect(tryParseDuration(text)).toBeNull();
  });
});

describe('formatDuration', () => {
  it.each([
    [30, '<1m'],
    [18 * 60, '18m'],
    [3 * 3600 + 20 * 60, '3h 20m'],
    [2 * 86_400 + 4 * 3600, '2d 4h'],
  ])('formats %d as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('formatSignedDuration', () => {
  it('formats positive and negative deltas', () => {
    expect(formatSignedDuration(120)).toBe('+2m');
    expect(formatSignedDuration(-180)).toBe('−3m');
    expect(formatSignedDuration(30)).toBe('0m');
  });
});
