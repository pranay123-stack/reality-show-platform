import { describe, expect, it } from 'vitest';

import {
  boundsForKey,
  isValidTimezone,
  isoWeek,
  periodBounds,
  periodKeyFor,
  zonedParts,
  zonedTimeToUtc,
} from '../periods.js';

/**
 * The whole reason these functions take an instant rather than reading the
 * clock: "does the daily board roll over at midnight in Kolkata" becomes a test
 * instead of a thing you find out from a support ticket.
 */

describe('zone conversion', () => {
  it('renders an instant in the zone asked for', () => {
    // 2026-08-10T18:30:00Z is 2026-08-11 00:00 in Kolkata (+05:30).
    const parts = zonedParts(new Date('2026-08-10T18:30:00Z'), 'Asia/Kolkata');
    expect(parts).toMatchObject({ year: 2026, month: 8, day: 11, hour: 0, minute: 0 });
  });

  it('renders midnight as hour 0, not 24', () => {
    expect(zonedParts(new Date('2026-08-10T00:00:00Z'), 'UTC').hour).toBe(0);
  });

  it('round-trips a wall-clock time back to the right instant', () => {
    const instant = zonedTimeToUtc(
      { year: 2026, month: 8, day: 11, hour: 0, minute: 0, second: 0 },
      'Asia/Kolkata',
    );
    expect(instant.toISOString()).toBe('2026-08-10T18:30:00.000Z');
  });

  it('handles a half-hour offset zone', () => {
    const instant = zonedTimeToUtc(
      { year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      'Asia/Kathmandu',
    );
    // +05:45.
    expect(instant.toISOString()).toBe('2025-12-31T18:15:00.000Z');
  });

  it('recognises a nonsense zone', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('period keys', () => {
  it('names a day by the zone’s calendar, not the server’s', () => {
    const instant = new Date('2026-08-10T18:30:00Z');
    expect(periodKeyFor('DAILY', instant, 'UTC')).toBe('2026-08-10');
    // Same instant, already tomorrow in Kolkata.
    expect(periodKeyFor('DAILY', instant, 'Asia/Kolkata')).toBe('2026-08-11');
  });

  it('names a week by ISO rules', () => {
    expect(periodKeyFor('WEEKLY', new Date('2026-08-10T12:00:00Z'), 'UTC')).toBe('2026-W33');
  });

  it('gives the season a single key that never changes', () => {
    expect(periodKeyFor('SEASON', new Date('2026-01-01T00:00:00Z'), 'UTC')).toBe('season');
    expect(periodKeyFor('SEASON', new Date('2027-12-31T23:59:59Z'), 'UTC')).toBe('season');
  });

  it('puts 1 January 2027 in the last ISO week of 2026', () => {
    // 2027-01-01 is a Friday, so ISO puts it in week 53 of 2026.
    expect(isoWeek({ year: 2027, month: 1, day: 1, hour: 0, minute: 0, second: 0 })).toEqual({
      year: 2026,
      week: 53,
    });
  });
});

describe('period bounds', () => {
  it('bounds a UTC day exactly', () => {
    const bounds = periodBounds('DAILY', new Date('2026-08-10T13:00:00Z'), 'UTC');
    expect(bounds.start.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(bounds.end?.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('bounds a day in an offset zone', () => {
    const bounds = periodBounds('DAILY', new Date('2026-08-10T19:00:00Z'), 'Asia/Kolkata');
    // The Kolkata day of 11 August starts at 18:30Z on the 10th.
    expect(bounds.key).toBe('2026-08-11');
    expect(bounds.start.toISOString()).toBe('2026-08-10T18:30:00.000Z');
    expect(bounds.end?.toISOString()).toBe('2026-08-11T18:30:00.000Z');
  });

  it('starts the week on Monday', () => {
    // 2026-08-10 is a Monday.
    const bounds = periodBounds('WEEKLY', new Date('2026-08-13T09:00:00Z'), 'UTC');
    expect(bounds.start.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(bounds.end?.toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });

  it('keeps a day 24 hours long across a DST spring-forward', () => {
    // New York loses an hour on 8 March 2026, so that local day is 23h real.
    const bounds = periodBounds('DAILY', new Date('2026-03-08T12:00:00Z'), 'America/New_York');
    const hours = (bounds.end!.getTime() - bounds.start.getTime()) / 3_600_000;
    expect(bounds.key).toBe('2026-03-08');
    expect(hours).toBe(23);
  });

  it('gives a season no end', () => {
    const bounds = periodBounds('SEASON', new Date(), 'UTC');
    expect(bounds.end).toBeNull();
    expect(bounds.start.getTime()).toBe(0);
  });

  it('resolves bounds from a named key', () => {
    const bounds = boundsForKey('DAILY', '2026-08-10', 'UTC');
    expect(bounds?.start.toISOString()).toBe('2026-08-10T00:00:00.000Z');

    const week = boundsForKey('WEEKLY', '2026-W33', 'UTC');
    expect(week?.start.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('rejects a malformed key rather than guessing', () => {
    expect(boundsForKey('DAILY', 'yesterday', 'UTC')).toBeNull();
    expect(boundsForKey('WEEKLY', '2026-08-10', 'UTC')).toBeNull();
  });
});
