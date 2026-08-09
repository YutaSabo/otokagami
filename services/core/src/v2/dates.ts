import type { DateOnly } from "./types.js";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertDateOnly(value: string): asserts value is DateOnly {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (match === null) throw new RangeError(`Invalid date-only value: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid date-only value: ${value}`);
  }
}

export function addCalendarDays(date: DateOnly, days: number): DateOnly {
  assertDateOnly(date);
  if (!Number.isInteger(days)) throw new RangeError("Calendar day offset must be an integer.");
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year!, month! - 1, day! + days));
  return formatUtcDate(result);
}

export function calendarDateFromInstant(instant: string | Date, timeZone: string): DateOnly {
  const date = instant instanceof Date ? new Date(instant.getTime()) : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid instant.");

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
  } catch {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) throw new RangeError("Unable to derive Calendar Date.");
    return value;
  };
  const result = `${get("year")}-${get("month")}-${get("day")}`;
  assertDateOnly(result);
  return result;
}

export function compareDateOnly(left: DateOnly, right: DateOnly): number {
  assertDateOnly(left);
  assertDateOnly(right);
  return left.localeCompare(right);
}

function formatUtcDate(date: Date): DateOnly {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
