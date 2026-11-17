import { describe, expect, it } from 'vitest';
import {
  addDays,
  cleanFocusText,
  daysBetween,
  entryFor,
  type FocusEntry,
  isDayKey,
  MAX_ENTRIES,
  MAX_FOCUS_CHARS,
  msUntilNextDay,
  previousEntry,
  relativeDay,
  sanitizeEntries,
  setFocus,
  streak,
  toggleDone,
} from './mainFocus';

const done = (day: string, text = day): FocusEntry => ({ day, text, doneAt: `${day}T18:00:00.000Z` });
const open = (day: string, text = day): FocusEntry => ({ day, text, doneAt: null });
const NOW = '2026-11-17T09:00:00.000Z';

describe('day keys', () => {
  it('accepts real calendar dates only', () => {
    expect(isDayKey('2026-11-17')).toBe(true);
    expect(isDayKey('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', 'today', '', null, 20261117]) expect(isDayKey(bad)).toBe(false);
  });

  it('addDays crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-11-17', 0)).toBe('2026-11-17');
    expect(addDays('2026-11-17', -30)).toBe('2026-10-18');
  });

  it('addDays is not thrown off by daylight-saving weekends', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // US spring-forward
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // EU spring-forward
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26'); // EU fall-back
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US fall-back
    expect(addDays('2026-03-30', -2)).toBe('2026-03-28');
  });

  it('daysBetween counts whole calendar days, in either direction', () => {
    expect(daysBetween('2026-11-16', '2026-11-17')).toBe(1);
    expect(daysBetween('2026-11-17', '2026-11-17')).toBe(0);
    expect(daysBetween('2026-11-17', '2026-11-10')).toBe(-7);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // across a DST change
    expect(daysBetween('2025-12-31', '2027-01-01')).toBe(366);
  });
});

describe('cleanFocusText', () => {
  it('is one tidy line, capped', () => {
    expect(cleanFocusText('  Ship   the\n\nreport \t')).toBe('Ship the report');
    expect(cleanFocusText('x'.repeat(500))).toHaveLength(MAX_FOCUS_CHARS);
    expect(cleanFocusText('   ')).toBe('');
  });
});

describe('sanitizeEntries', () => {
  it('drops junk, keeps good rows, sorts by day and lets the later duplicate win', () => {
    const out = sanitizeEntries([
      done('2026-11-16', 'b'),
      { day: '2026-02-30', text: 'impossible' },
      { day: '2026-11-15', text: '   ' },
      { day: '2026-11-14', text: 5 },
      null,
      'x',
      { day: '2026-11-13', text: 'a', doneAt: 'not a date' },
      { day: '2026-11-16', text: 'b2', doneAt: null },
    ]);
    expect(out).toEqual([
      { day: '2026-11-13', text: 'a', doneAt: null },
      { day: '2026-11-16', text: 'b2', doneAt: null },
    ]);
  });

  it('turns anything that is not a list into an empty one', () => {
    for (const junk of [undefined, null, 5, 'x', {}]) expect(sanitizeEntries(junk)).toEqual([]);
  });

  it('keeps only the newest entries when there are too many', () => {
    const many = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => open(addDays('2024-01-01', i)));
    const out = sanitizeEntries(many);
    expect(out).toHaveLength(MAX_ENTRIES);
    expect(out.at(-1)?.day).toBe(addDays('2024-01-01', MAX_ENTRIES + 19));
  });
});

describe('setFocus / toggleDone', () => {
  it('sets today without touching other days', () => {
    const list = setFocus([done('2026-11-16')], '2026-11-17', '  Write the outline ');
    expect(list.map((e) => e.day)).toEqual(['2026-11-16', '2026-11-17']);
    expect(entryFor(list, '2026-11-17')).toEqual({ day: '2026-11-17', text: 'Write the outline', doneAt: null });
  });

  it('editing the text keeps the done mark; empty text clears the day', () => {
    const base = [done('2026-11-17', 'old')];
    expect(entryFor(setFocus(base, '2026-11-17', 'new'), '2026-11-17')).toMatchObject({ text: 'new', doneAt: '2026-11-17T18:00:00.000Z' });
    expect(setFocus(base, '2026-11-17', '   ')).toEqual([]);
  });

  it('toggles done on and off, and ignores a day with no focus', () => {
    const on = toggleDone([open('2026-11-17')], '2026-11-17', NOW);
    expect(entryFor(on, '2026-11-17')?.doneAt).toBe(NOW);
    expect(entryFor(toggleDone(on, '2026-11-17', NOW), '2026-11-17')?.doneAt).toBeNull();
    expect(toggleDone([open('2026-11-16')], '2026-11-17', NOW)).toEqual([open('2026-11-16')]);
  });
});

describe('previousEntry', () => {
  it('is the newest entry before the given day, however long ago', () => {
    const list = [open('2026-10-01', 'old'), done('2026-11-14', 'friday'), open('2026-11-17', 'today')];
    expect(previousEntry(list, '2026-11-17')?.text).toBe('friday');
    expect(previousEntry(list, '2026-11-15')?.text).toBe('friday');
    expect(previousEntry(list, '2026-10-01')).toBeNull();
    expect(previousEntry([], '2026-11-17')).toBeNull();
  });
});

describe('streak', () => {
  const today = '2026-11-17';

  it('counts consecutive completed days ending today', () => {
    expect(streak([done('2026-11-15'), done('2026-11-16'), done('2026-11-17')], today)).toBe(3);
  });

  it('today not being finished yet does not break it — the count ends yesterday', () => {
    expect(streak([done('2026-11-15'), done('2026-11-16'), open('2026-11-17')], today)).toBe(2);
    expect(streak([done('2026-11-16')], today)).toBe(1);
  });

  it('a missed or unfinished day breaks it', () => {
    expect(streak([done('2026-11-13'), done('2026-11-14'), done('2026-11-16'), done('2026-11-17')], today)).toBe(2); // 15th missing
    expect(streak([done('2026-11-14'), open('2026-11-15'), done('2026-11-16'), done('2026-11-17')], today)).toBe(2); // 15th not done
  });

  it('survives a multi-day gap by starting over', () => {
    expect(streak([done('2026-11-01'), done('2026-11-02'), done('2026-11-03')], today)).toBe(0);
    expect(streak([done('2026-11-01'), done('2026-11-02'), done('2026-11-17')], today)).toBe(1);
  });

  it('works across month/year edges and DST changes', () => {
    expect(streak([done('2026-12-30'), done('2026-12-31'), done('2027-01-01')], '2027-01-01')).toBe(3);
    expect(streak([done('2026-03-28'), done('2026-03-29'), done('2026-03-30')], '2026-03-30')).toBe(3);
  });

  it('ignores entries dated in the future (a clock or time-zone change)', () => {
    expect(streak([done('2026-11-16'), done('2026-11-20')], today)).toBe(1);
    expect(streak([], today)).toBe(0);
  });
});

describe('rollover', () => {
  it('yesterday’s focus is simply not today’s once the date string changes — nothing needs to run at midnight', () => {
    const entries = setFocus([], '2026-11-16', 'Finish the report');
    expect(entryFor(entries, '2026-11-16')?.text).toBe('Finish the report');
    expect(entryFor(entries, '2026-11-17')).toBeNull();
    expect(previousEntry(entries, '2026-11-17')?.text).toBe('Finish the report');
    // …and after a three-week absence it's still found, but is no longer "yesterday"
    expect(previousEntry(entries, '2026-12-08')?.text).toBe('Finish the report');
    expect(relativeDay('2026-11-16', '2026-12-08')).not.toBe('Yesterday');
  });
});

describe('msUntilNextDay', () => {
  it('is the time left until local midnight', () => {
    expect(msUntilNextDay(new Date(2026, 5, 15, 23, 59, 30))).toBe(30_000);
    expect(msUntilNextDay(new Date(2026, 5, 15, 12, 0, 0))).toBe(12 * 3_600_000);
  });
});

describe('relativeDay', () => {
  it('says Yesterday, then a weekday within the week, then a date', () => {
    expect(relativeDay('2026-11-16', '2026-11-17')).toBe('Yesterday');
    expect(relativeDay('2026-11-14', '2026-11-17')).toMatch(/\p{L}/u); // a weekday name
    expect(relativeDay('2026-11-14', '2026-11-17')).not.toMatch(/\d/);
    expect(relativeDay('2026-11-01', '2026-11-17')).toMatch(/\d/); // "Nov 1"
  });
});
