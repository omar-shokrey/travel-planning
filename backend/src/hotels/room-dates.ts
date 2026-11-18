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
