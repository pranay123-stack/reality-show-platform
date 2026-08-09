import type { LeaderboardWindow } from '@reality/shared';

/**
 * Period boundaries, in a configurable timezone.
 *
 * Pure and clock-free: every function takes the instant it should reason about.
 * That is what makes "does the daily board reset at midnight in Kolkata" a unit
 * test rather than a thing you find out in production.
 *
 * The zone belongs to the *board*, not to the server and not to the viewer. A
 * shared ranking needs one agreed definition of "today"; if each viewer's own
 * zone defined the window, two people would be on different boards and their
 * scores would not be comparable. The viewer's zone is used for *displaying*
 * when the reset happens, which is a presentation concern.
 */

/**
 * Wall-clock fields for an instant in a given zone.
 *
 * `Intl` is the only correct way to do this — it carries the IANA database, so
 * daylight saving and historical offset changes come for free. Hand-rolled
 * offset arithmetic gets the day wrong twice a year.
 */
interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

/** Throws for an unknown zone, which is what we want at config-load time. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(instant: Date, timezone: string): ZonedParts {
  const parts = formatterFor(timezone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // `hour12: false` renders midnight as 24 in some ICU versions.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** The UTC instant of a given wall-clock time in a zone. */
export function zonedTimeToUtc(parts: ZonedParts, timezone: string): Date {
  // Guess that the wall time is UTC, measure how far off the zone renders it,
  // then correct. Two passes settle the case where the correction itself crosses
  // a DST boundary.
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = new Date(guess);

  for (let pass = 0; pass < 2; pass += 1) {
    const rendered = zonedParts(instant, timezone);
    const renderedUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
    );
    const drift = guess - renderedUtc;
    if (drift === 0) break;
    instant = new Date(instant.getTime() + drift);
  }

  return instant;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** ISO-8601 week number, computed on the zone's own calendar. */
export function isoWeek(parts: ZonedParts): { year: number; week: number } {
  // Thursday decides the year an ISO week belongs to.
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayOfWeek + 3);

  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);

  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { year: isoYear, week };
}

export const SEASON_PERIOD_KEY = 'season';

/**
 * The key identifying the period an instant falls in.
 *
 * Daily  → `2026-08-10`
 * Weekly → `2026-W33`
 * Season → `season` (never resets, so there is only ever one)
 */
export function periodKeyFor(
  window: LeaderboardWindow,
  instant: Date,
  timezone: string,
): string {
  if (window === 'SEASON') return SEASON_PERIOD_KEY;

  const parts = zonedParts(instant, timezone);
  if (window === 'DAILY') return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;

  const { year, week } = isoWeek(parts);
  return `${year}-W${pad(week)}`;
}

export interface PeriodBounds {
  key: string;
  /** Inclusive. */
  start: Date;
  /** Exclusive. Null for a season, which has no end. */
  end: Date | null;
}

/** The half-open interval [start, end) a period covers, in real UTC instants. */
export function periodBounds(
  window: LeaderboardWindow,
  instant: Date,
  timezone: string,
): PeriodBounds {
  const key = periodKeyFor(window, instant, timezone);

  if (window === 'SEASON') {
    // A season has no reset. Start at the epoch so every ledger row qualifies.
    return { key, start: new Date(0), end: null };
  }

  const parts = zonedParts(instant, timezone);
  const midnight = { ...parts, hour: 0, minute: 0, second: 0 };

  if (window === 'DAILY') {
    const start = zonedTimeToUtc(midnight, timezone);
    const nextDay = zonedParts(new Date(start.getTime() + 36 * 3_600_000), timezone);
    const end = zonedTimeToUtc({ ...nextDay, hour: 0, minute: 0, second: 0 }, timezone);
    return { key, start, end };
  }

  // Weekly: back up to Monday on the zone's calendar.
  const weekday = (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7;
  const mondayUtcGuess = Date.UTC(parts.year, parts.month - 1, parts.day - weekday);
  const monday = new Date(mondayUtcGuess);
  const start = zonedTimeToUtc(
    {
      year: monday.getUTCFullYear(),
      month: monday.getUTCMonth() + 1,
      day: monday.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timezone,
  );

  const nextMonday = zonedParts(new Date(start.getTime() + 7 * 86_400_000 + 12 * 3_600_000), timezone);
  const end = zonedTimeToUtc({ ...nextMonday, hour: 0, minute: 0, second: 0 }, timezone);
  return { key, start, end };
}

/** Bounds for a period named explicitly, e.g. when reading yesterday's board. */
export function boundsForKey(
  window: LeaderboardWindow,
  periodKey: string,
  timezone: string,
): PeriodBounds | null {
  if (window === 'SEASON') return { key: SEASON_PERIOD_KEY, start: new Date(0), end: null };

  if (window === 'DAILY') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodKey);
    if (!match) return null;
    const midday = zonedTimeToUtc(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: 12,
        minute: 0,
        second: 0,
      },
      timezone,
    );
    return periodBounds('DAILY', midday, timezone);
  }

  const match = /^(\d{4})-W(\d{2})$/.exec(periodKey);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);

  // The Monday of ISO week 1 is the Monday on or before 4 January.
  const fourth = new Date(Date.UTC(year, 0, 4));
  const offset = (fourth.getUTCDay() + 6) % 7;
  const firstMonday = new Date(Date.UTC(year, 0, 4 - offset));
  const target = new Date(firstMonday.getTime() + (week - 1) * 7 * 86_400_000);

  const midday = zonedTimeToUtc(
    {
      year: target.getUTCFullYear(),
      month: target.getUTCMonth() + 1,
      day: target.getUTCDate(),
      hour: 12,
      minute: 0,
      second: 0,
    },
    timezone,
  );
  return periodBounds('WEEKLY', midday, timezone);
}
