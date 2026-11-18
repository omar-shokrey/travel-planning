import { DateTime } from 'luxon';

/**
 * A range of nights: `from` is the first night, `to` is the checkout boundary
 * and is not included, as in HTL-04. Both are `YYYY-MM-DD` strings, which
 * compare correctly as plain text, so no time zone is ever involved.
 */
export interface DateRange {
  from: string;
  to: string;
}

/** The ranges ordered by their first night. The list given is not changed. */
export function sortRanges<T extends DateRange>(ranges: readonly T[]): T[] {
  return [...ranges].sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : 0,
  );
}

/**
 * The first two ranges that share a night, or `null` when none do. Ranges that
 * only touch (one ends on the day the next starts) do not overlap.
 */
export function findOverlap<T extends DateRange>(
  ranges: readonly T[],
): [T, T] | null {
  const sorted = sortRanges(ranges);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].from < sorted[index - 1].to) {
      return [sorted[index - 1], sorted[index]];
    }
  }
  return null;
}

/** Whether one of the ranges includes the night that starts on `date`. */
export function coversNight(
  ranges: readonly DateRange[],
  date: string,
): boolean {
  return ranges.some((range) => range.from <= date && date < range.to);
}

/** The day after `date`. Calendar arithmetic is done by luxon, never by hand. */
function nextDay(date: string): string {
  return DateTime.fromISO(date, { zone: 'utc' })
    .plus({ days: 1 })
    .toISODate() as string;
}

/** Every night of a range, in order: from `from` up to the day before `to`. */
export function nightsOf(range: DateRange): string[] {
  const nights: string[] = [];
  for (let date = range.from; date < range.to; date = nextDay(date)) {
    nights.push(date);
  }
  return nights;
}

/** How many nights a range has, without listing them. */
export function nightCount(range: DateRange): number {
  const from = DateTime.fromISO(range.from, { zone: 'utc' });
  const to = DateTime.fromISO(range.to, { zone: 'utc' });
  return Math.max(0, Math.round(to.diff(from, 'days').days));
}

/**
 * Joins single nights into ranges: consecutive nights become one range whose
 * `to` is the day after its last night. Duplicates are ignored.
 */
export function toRanges(nights: readonly string[]): DateRange[] {
  const sorted = [...new Set(nights)].sort();
  const ranges: DateRange[] = [];
  for (const night of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.to === night) {
      last.to = nextDay(night);
    } else {
      ranges.push({ from: night, to: nextDay(night) });
    }
  }
  return ranges;
}

/** Today's date in UTC (`YYYY-MM-DD`). */
export function todayUtc(): string {
  return DateTime.utc().toISODate() as string;
}
