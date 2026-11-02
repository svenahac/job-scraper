import { describe, it, expect } from 'vitest';
import {
  countryCode, countryFromLocation, countryFromSlugTail, rfc822Date, dayMonthYear,
  todayInBrussels, addDays, stillOpen,
} from '../../src/sources/intl-boards.js';

describe('country helpers', () => {
  it('maps English, French and German names, ignoring case', () => {
    expect(countryCode('Belgium')).toBe('BE');
    expect(countryCode('belgique')).toBe('BE');
    expect(countryCode('Slowenien')).toBe('SI');
    expect(countryCode('Multiple Countries')).toBeNull();
  });

  it('takes the last part of a location', () => {
    expect(countryFromLocation('Ljubljana, Slovenia')).toBe('SI');
    expect(countryFromLocation('Brussels')).toBeNull();
    expect(countryFromLocation(null)).toBeNull();
  });

  it('reads a country off a slug tail, multi-word names included', () => {
    expect(countryFromSlugTail('Grantmaker_Elevate_Philanthropy_London_United_Kingdom'))
      .toEqual({ name: 'United Kingdom', code: 'GB' });
    expect(countryFromSlugTail('Regional_Hub_Managers_Multiple_Countries')).toBeNull();
  });
});

describe('date helpers', () => {
  it('keeps the calendar date an RFC 822 stamp states', () => {
    expect(rfc822Date('Sat, 31 Oct 2026 00:30:00 +0100')).toBe('2026-10-31');
    expect(rfc822Date('garbage')).toBeNull();
  });

  it('parses "4 November 2026"', () => {
    expect(dayMonthYear('4 November 2026, 12:00 (CET)')).toBe('2026-11-04');
  });

  it('gives today in Brussels time', () => {
    // 23:30 UTC on 1 November is already 2 November in Brussels (UTC+1).
    expect(todayInBrussels(new Date('2026-11-01T23:30:00Z'))).toBe('2026-11-02');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-11-02', -2)).toBe('2026-10-31');
  });

  it('treats a missing deadline as open and today as still open', () => {
    expect(stillOpen(null, '2026-11-02')).toBe(true);
    expect(stillOpen('2026-11-02', '2026-11-02')).toBe(true);
    expect(stillOpen('2026-11-01', '2026-11-02')).toBe(false);
  });
});
