import type { DateOnly } from "./types.js";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

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
  if (typeof instant === "string") assertRfc3339Instant(instant);
  assertIanaTimeZone(timeZone);
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

export function assertRfc3339Instant(value: string): void {
  const match = RFC3339_INSTANT_PATTERN.exec(value);
  if (match === null) throw new RangeError(`Invalid RFC 3339 instant: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new RangeError(`Invalid RFC 3339 instant: ${value}`);
  }
}

export function assertIanaTimeZone(value: string): void {
  if (value.trim() !== value || value.length === 0) {
    throw new RangeError(`Invalid IANA timezone: ${value}`);
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new RangeError(`Invalid IANA timezone: ${value}`);
  }
}

export function assertPositiveLearningSequence(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("learningDaySequence must be a positive safe integer.");
  }
}

export function assertTrialProgramDay(value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 7)) {
    throw new RangeError("trialProgramDay must be between 1 and 7.");
  }
}

export function assertUuid(value: string, fieldName = "id"): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new RangeError(`${fieldName} must be a UUID.`);
  }
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
