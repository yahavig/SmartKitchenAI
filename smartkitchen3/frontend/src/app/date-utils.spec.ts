/** Verifies canonical date parsing for ISO and MongoDB Extended JSON values. */
import { isValidDateInput, parseDate, toIsoDate } from './date-utils';

describe('date utilities', () => {
  it('parses ISO and Mongo Extended JSON dates', () => {
    expect(parseDate('2026-08-22T00:00:00Z')?.toISOString()).toBe('2026-08-22T00:00:00.000Z');
    expect(parseDate({ $date: '2026-08-22T00:00:00Z' })?.toISOString()).toBe('2026-08-22T00:00:00.000Z');
  });

  it('returns a safe fallback for invalid dates', () => {
    expect(parseDate('invalid')).toBeNull();
    expect(toIsoDate('invalid')).toBe('');
  });

  it('validates calendar dates without rollover', () => {
    expect(isValidDateInput('2026-08-22')).toBeTrue();
    expect(isValidDateInput('2026-02-30')).toBeFalse();
    expect(isValidDateInput('')).toBeFalse();
  });
});
