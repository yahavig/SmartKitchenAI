/** Provides canonical parsing and ISO serialization for API date values. */
export function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const raw = typeof value === 'object' && value !== null && '$date' in value
    ? (value as { $date: unknown }).$date
    : value;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIsoDate(value: unknown, fallback = ''): string {
  return parseDate(value)?.toISOString() ?? fallback;
}

/** Validates an HTML date input without allowing JavaScript's date rollover behavior. */
export function isValidDateInput(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
