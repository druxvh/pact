import type { Answer } from '@/lib/omnibox/types';

/** A calendar day with no time or zone — all the arithmetic below is on day numbers, so DST can never shift a result. */
type Ymd = { y: number; m: number; d: number };

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};
/** [month, day] — the holidays whose date doesn't move. */
const HOLIDAYS: Record<string, [number, number]> = {
  christmas: [11, 25],
  xmas: [11, 25],
  'christmas eve': [11, 24],
  halloween: [9, 31],
  'new year': [0, 1],
  'new years': [0, 1],
  "new year's": [0, 1],
  'new years day': [0, 1],
  "new year's day": [0, 1],
  'new years eve': [11, 31],
  "new year's eve": [11, 31],
  valentines: [1, 14],
  "valentine's": [1, 14],
  'valentines day': [1, 14],
  "valentine's day": [1, 14],
};

const DAY_MS = 86_400_000;
const dayNumber = ({ y, m, d }: Ymd) => Math.round(Date.UTC(y, m, d) / DAY_MS);
const fromDayNumber = (n: number): Ymd => {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
};
export const ymdOf = (date: Date): Ymd => ({ y: date.getFullYear(), m: date.getMonth(), d: date.getDate() });
const isValid = (v: Ymd) => {
  const back = fromDayNumber(dayNumber(v));
  return back.y === v.y && back.m === v.m && back.d === v.d;
};
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const iso = ({ y, m, d }: Ymd) => `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const utcDate = (v: Ymd) => new Date(Date.UTC(v.y, v.m, v.d));
const fmt = (v: Ymd, locale: string | undefined, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(utcDate(v));
const fmtShort = (v: Ymd, locale?: string) => fmt(v, locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const fmtLong = (v: Ymd, locale?: string) => fmt(v, locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

function isoWeek(v: Ymd): number {
  const dt = utcDate(v);
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7) + 3); // the Thursday of this week
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((dt.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function cleanDateText(text: string): string {
  return text
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/(\d)(?:st|nd|rd|th)\b/g, '$1')
    .replace(/^on\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "dec 25", "25 dec 2027", "2026-12-25", "friday", "christmas", "tomorrow"…
 * A date with no year resolves to its next occurrence (`future`) or its latest one (`past`).
 */
export function parseDateText(raw: string, today: Ymd, bias: 'future' | 'past' = 'future'): Ymd | null {
  const t = cleanDateText(raw);
  if (!t) return null;
  const todayN = dayNumber(today);
  if (t === 'today' || t === 'now') return today;
  if (t === 'tomorrow') return fromDayNumber(todayN + 1);
  if (t === 'yesterday') return fromDayNumber(todayN - 1);

  const resolve = (m: number, d: number, y?: number): Ymd | null => {
    if (y !== undefined) {
      const v = { y, m, d };
      return isValid(v) ? v : null;
    }
    const thisYear = { y: today.y, m, d };
    if (!isValid(thisYear)) {
      // Feb 29 in a non-leap year: look to the nearest year that has one
      const step = bias === 'future' ? 1 : -1;
      for (let yy = today.y + step; Math.abs(yy - today.y) <= 8; yy += step) {
        const v = { y: yy, m, d };
        if (isValid(v)) return v;
      }
      return null;
    }
    const n = dayNumber(thisYear);
    if (bias === 'future' && n < todayN) return isValid({ y: today.y + 1, m, d }) ? { y: today.y + 1, m, d } : resolve(m, d, today.y + 4);
    if (bias === 'past' && n > todayN) return { y: today.y - 1, m, d };
    return thisYear;
  };

  const holiday = HOLIDAYS[t];
  if (holiday) return resolve(holiday[0], holiday[1]);

  const isoM = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (isoM) return resolve(Number(isoM[2]) - 1, Number(isoM[3]), Number(isoM[1]));

  const monthFirst = /^([a-z]+)\.? (\d{1,2})(?: (\d{4}))?$/.exec(t);
  if (monthFirst && MONTHS[monthFirst[1] ?? ''] !== undefined) {
    return resolve(MONTHS[monthFirst[1] ?? ''] as number, Number(monthFirst[2]), monthFirst[3] ? Number(monthFirst[3]) : undefined);
  }
  const dayFirst = /^(\d{1,2}) ([a-z]+)\.?(?: (\d{4}))?$/.exec(t);
  if (dayFirst && MONTHS[dayFirst[2] ?? ''] !== undefined) {
    return resolve(MONTHS[dayFirst[2] ?? ''] as number, Number(dayFirst[1]), dayFirst[3] ? Number(dayFirst[3]) : undefined);
  }

  const weekday = /^(?:next |this |last )?([a-z]+)$/.exec(t);
  const wd = weekday ? WEEKDAYS[weekday[1] ?? ''] : undefined;
  if (wd !== undefined) {
    const cur = (((todayN + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
    const delta = bias === 'future' ? ((wd - cur + 6) % 7) + 1 : -(((cur - wd + 6) % 7) + 1);
    return fromDayNumber(todayN + delta);
  }
  return null;
}

function addToDay(base: Ymd, amount: number, unit: string): Ymd | null {
  if (/^(?:d|days?)$/.test(unit)) return fromDayNumber(dayNumber(base) + amount);
  if (/^(?:w|wks?|weeks?)$/.test(unit)) return fromDayNumber(dayNumber(base) + amount * 7);
  const months = /^(?:mo|mos|months?)$/.test(unit) ? amount : /^(?:y|yrs?|years?)$/.test(unit) ? amount * 12 : null;
  if (months === null) return null;
  const total = base.y * 12 + base.m + months;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { y, m, d: Math.min(base.d, last) };
}

const relative = (delta: number): string =>
  delta === 0 ? 'today' : delta === 1 ? 'tomorrow' : delta === -1 ? 'yesterday' : delta > 0 ? `in ${plural(delta, 'day')}` : `${plural(-delta, 'day')} ago`;

function dateCard(expression: string, v: Ymd, today: Ymd, locale: string | undefined): Answer {
  const delta = dayNumber(v) - dayNumber(today);
  const value = fmtShort(v, locale);
  return {
    kind: 'date',
    expression,
    value,
    copy: value,
    caption: `${relative(delta)[0]?.toUpperCase()}${relative(delta).slice(1)}`,
    rows: [{ label: 'ISO', value: iso(v), copy: iso(v) }],
  };
}

const COUNTDOWN = /^(?:how\s+many\s+)?(days?|weeks?)(?:\s+left)?\s+(until|till|to|before|since|after)\s+(.+)$/i;
const COUNTDOWN_B = /^(?:how\s+long\s+(?:until|till|to)|countdown\s+(?:to|until))\s+(.+)$/i;
const ARITH = /^(.+?)\s*([+-])\s*(\d{1,5})\s*(days?|d|weeks?|wks?|w|months?|mos?|years?|yrs?|y)$/i;
const FROM_NOW = /^(\d{1,5})\s*(days?|weeks?|wks?|months?|years?|yrs?)\s+(from\s+now|from\s+today|ago)$/i;
const IN_FUTURE = /^in\s+(\d{1,5})\s*(days?|weeks?|wks?|months?|years?|yrs?)$/i;
const FROM_DATE = /^(\d{1,5})\s*(days?|weeks?|wks?|months?|years?|yrs?)\s+(from|after|before)\s+(.+)$/i;
const TODAY =
  /^(?:today|date|current date|today's date|what(?:'s| is)\s+(?:the\s+)?(?:today'?s?\s+)?date(?:\s+today)?|what\s+day\s+is\s+(?:it|today)(?:\s+today)?|what's\s+today)\??$/i;

/** `days until dec 25`, `days since mar 3`, `today + 45 days`, `3 weeks from now`, `date`, `tomorrow`. */
export function dateAnswer(input: string, now: Date, locale?: string): Answer | null {
  const text = input.trim().replace(/\?+$/, '');
  if (!text || text.length > 80) return null;
  const today = ymdOf(now);
  const todayN = dayNumber(today);

  if (TODAY.test(text)) {
    const day = dayNumber(today) - dayNumber({ y: today.y, m: 0, d: 1 }) + 1;
    return {
      kind: 'date',
      expression: 'Today',
      value: fmtLong(today, locale),
      copy: fmtLong(today, locale),
      caption: `Week ${isoWeek(today)} · day ${day} of ${isLeap(today.y) ? 366 : 365}`,
      rows: [{ label: 'ISO', value: iso(today), copy: iso(today) }],
    };
  }
  if (/^(?:tomorrow|yesterday)$/i.test(text)) {
    const v = parseDateText(text, today);
    return v ? dateCard(text, v, today, locale) : null;
  }

  // countdowns
  const a = COUNTDOWN.exec(text);
  const b = a ? null : COUNTDOWN_B.exec(text);
  if (a || b) {
    const unitWeeks = /^week/i.test(a?.[1] ?? '');
    const word = (a?.[2] ?? 'until').toLowerCase();
    const past = word === 'since' || word === 'after';
    const target = parseDateText((a ? a[3] : b?.[1]) ?? '', today, past ? 'past' : 'future');
    if (!target) return null;
    const delta = dayNumber(target) - todayN;
    const abs = Math.abs(delta);
    const weeks = Math.floor(abs / 7);
    const rest = abs % 7;
    const value = delta === 0 ? 'Today' : unitWeeks ? plural(Math.round((abs / 7) * 10) / 10, 'week') : plural(abs, 'day');
    return {
      kind: 'date',
      expression: text,
      value,
      copy: value,
      caption: delta === 0 ? fmtShort(target, locale) : `${delta > 0 ? 'until' : 'since'} ${fmtShort(target, locale)}`,
      rows: abs >= 14 ? [{ label: 'In weeks', value: rest ? `${plural(weeks, 'week')}, ${plural(rest, 'day')}` : plural(weeks, 'week') }] : undefined,
    };
  }

  // date arithmetic
  const arith = ARITH.exec(text);
  if (arith) {
    const base = parseDateText(arith[1] ?? '', today);
    const sign = arith[2] === '-' ? -1 : 1;
    const v = base ? addToDay(base, sign * Number(arith[3]), (arith[4] ?? '').toLowerCase()) : null;
    if (v) return dateCard(text, v, today, locale);
  }
  const fromNow = FROM_NOW.exec(text);
  if (fromNow) {
    const v = addToDay(today, (/ago$/i.test(fromNow[3] ?? '') ? -1 : 1) * Number(fromNow[1]), (fromNow[2] ?? '').toLowerCase());
    if (v) return dateCard(text, v, today, locale);
  }
  const inFuture = IN_FUTURE.exec(text);
  if (inFuture) {
    const v = addToDay(today, Number(inFuture[1]), (inFuture[2] ?? '').toLowerCase());
    if (v) return dateCard(text, v, today, locale);
  }
  const fromDate = FROM_DATE.exec(text);
  if (fromDate) {
    const base = parseDateText(fromDate[4] ?? '', today);
    const v = base ? addToDay(base, (/before/i.test(fromDate[3] ?? '') ? -1 : 1) * Number(fromDate[1]), (fromDate[2] ?? '').toLowerCase()) : null;
    if (v) return dateCard(text, v, today, locale);
  }
  return null;
}
