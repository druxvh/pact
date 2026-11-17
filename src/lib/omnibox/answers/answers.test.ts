import { describe, expect, it } from 'vitest';
import { computeAnswer, parseDuration, parseIntent } from '@/lib/omnibox/answers';
import { dateAnswer, parseDateText, ymdOf } from '@/lib/omnibox/answers/dates';
import { timeAnswer, zoneOffsetMinutes } from '@/lib/omnibox/answers/zones';

// Tuesday 17 Nov 2026, 09:30 local; and the same instant-ish in UTC for zone maths.
const NOW = new Date(2026, 10, 17, 9, 30, 0);
const UTC_NOON = new Date('2026-11-17T12:00:00Z');
const answer = (q: string) => {
  const c = computeAnswer(q, { now: NOW, locale: 'en-US' });
  return c?.type === 'answer' ? c.answer : null;
};

describe('maths', () => {
  it('answers bare expressions and function calls', () => {
    expect(answer('12*(3+4)/2')?.value).toBe('42');
    expect(answer('sqrt(144)')?.value).toBe('12');
    expect(answer('sqrt 144')?.value).toBe('12');
    expect(answer('2^10')?.copy).toBe('1024');
    expect(answer('= 2+2')?.value).toBe('4');
    expect(answer('2+2=')?.value).toBe('4');
    expect(answer('0.1+0.2')?.value).toBe('0.3');
    expect(answer('1000*1000')).toMatchObject({ value: '1,000,000', copy: '1000000' });
  });

  it('understands the percentage phrasings people type', () => {
    expect(answer('15% of 240')?.value).toBe('36');
    expect(answer('what is 20% of 50')?.value).toBe('10');
    expect(answer('20% off 80')?.value).toBe('64');
    expect(answer('240 + 15%')?.value).toBe('276');
    expect(answer('100 - 20%')?.value).toBe('80');
    expect(answer('7 % 3')?.value).toBe('1'); // modulo is still modulo
  });

  it('does not hijack ordinary searches', () => {
    for (const q of [
      '5',
      '2026',
      'hello',
      'pi',
      'e',
      'covid-19',
      'state-of-the-art',
      '2026-12-25',
      '555-1234',
      '1.2.3',
      'node.js',
      'react 19',
      'what is love',
      'iphone 15 pro',
    ]) {
      expect(answer(q), q).toBeNull();
    }
  });

  it('shows nothing for maths that has no answer', () => {
    expect(answer('1/0')).toBeNull();
    expect(answer('2+')).toBeNull();
    expect(answer('sqrt(')).toBeNull();
  });
});

describe('unit conversion', () => {
  it('converts length, temperature and volume', () => {
    expect(answer('10 km in mi')).toMatchObject({ kind: 'convert', value: '6.213712 mi', expression: '10 km' });
    expect(answer('72 f to c')?.value).toBe('22.22222°C');
    expect(answer('0 c in f')?.value).toBe('32°F');
    expect(answer('3 cups in ml')?.value).toBe('709.7647 mL');
    expect(answer('1 mile to km')?.value).toBe('1.609344 km');
    expect(answer('5 feet in cm')?.value).toBe('152.4 cm');
  });

  it('accepts several spellings and thousands separators', () => {
    expect(answer('1,000 ft to m')?.value).toBe('304.8 m');
    expect(answer('100 kilometers into miles')?.kind).toBe('convert');
    expect(answer('2 hours in minutes')?.value).toBe('120 min');
    expect(answer('1 gb to mb')?.value).toBe('1,000 MB');
    expect(answer('60 mph in kph')?.kind).toBe('convert');
  });

  it('picks the category both units share, and refuses mismatches', () => {
    expect(answer('5 in in cm')?.value).toBe('12.7 cm');
    expect(answer('10 km in kg')).toBeNull();
    expect(answer('10 flurbs in mi')).toBeNull();
  });
});

describe('dates', () => {
  const ans = (q: string) => dateAnswer(q, NOW, 'en-US');

  it('counts days until and since', () => {
    expect(ans('days until dec 25')).toMatchObject({ value: '38 days', caption: 'until Fri, Dec 25, 2026' });
    expect(ans('days until christmas')?.value).toBe('38 days');
    expect(ans('days until 2026-12-25')?.value).toBe('38 days');
    expect(ans('days until nov 17')?.value).toBe('Today');
    expect(ans('days until jan 1')?.value).toBe('45 days'); // rolls over to next year
    expect(ans('days since mar 3')?.value).toBe('259 days');
    expect(ans('days until friday')?.value).toBe('3 days');
    expect(ans('weeks until dec 25')?.value).toBe('5.4 weeks');
    expect(ans('how many days until dec 25')?.value).toBe('38 days');
    expect(ans('days until dec 25')?.rows?.[0]).toEqual({ label: 'In weeks', value: '5 weeks, 3 days' });
  });

  it('does date arithmetic, including month ends and leap years', () => {
    expect(ans('today + 45 days')?.value).toBe('Fri, Jan 1, 2027');
    expect(ans('today - 2 weeks')?.value).toBe('Tue, Nov 3, 2026');
    expect(ans('3 weeks from now')?.value).toBe('Tue, Dec 8, 2026');
    expect(ans('in 10 days')?.value).toBe('Fri, Nov 27, 2026');
    expect(ans('2 days ago')?.value).toBe('Sun, Nov 15, 2026');
    expect(ans('jan 31 2027 + 1 month')?.value).toBe('Sun, Feb 28, 2027');
    expect(ans('feb 29 2028 + 1 year')?.value).toBe('Wed, Feb 28, 2029');
    expect(ans('tomorrow')).toMatchObject({ value: 'Wed, Nov 18, 2026', caption: 'Tomorrow' });
    expect(ans('today + 45 days')?.rows?.[0]?.copy).toBe('2027-01-01');
  });

  it('answers "what is today"', () => {
    expect(ans('today')).toMatchObject({ value: 'Tuesday, November 17, 2026', caption: 'Week 47 · day 321 of 365' });
    expect(ans("what's the date")?.kind).toBe('date');
  });

  it('ignores things that are not date questions', () => {
    for (const q of ['days', 'dec 25', 'today is the day', 'until', '3 weeks', 'days until nowhere']) expect(ans(q), q).toBeNull();
  });

  it('parseDateText resolves year-less dates to the next (or last) occurrence', () => {
    const today = ymdOf(NOW);
    expect(parseDateText('Dec 25th', today)).toEqual({ y: 2026, m: 11, d: 25 });
    expect(parseDateText('25 dec', today)).toEqual({ y: 2026, m: 11, d: 25 });
    expect(parseDateText('mar 3', today)).toEqual({ y: 2027, m: 2, d: 3 });
    expect(parseDateText('mar 3', today, 'past')).toEqual({ y: 2026, m: 2, d: 3 });
    expect(parseDateText('feb 30 2026', today)).toBeNull();
    expect(parseDateText('feb 29', today)).toEqual({ y: 2028, m: 1, d: 29 });
    expect(parseDateText('nonsense', today)).toBeNull();
  });
});

describe('time zones', () => {
  const t = (q: string) => timeAnswer(q, UTC_NOON, 'en-US');

  it('answers time in a city, by IANA name, alias or abbreviation', () => {
    expect(t('time in tokyo')).toMatchObject({ kind: 'time', value: '9:00 PM', expression: 'Time in Tokyo' });
    expect(t('time in new york')?.value).toBe('7:00 AM');
    expect(t('what time is it in london')?.value).toBe('12:00 PM');
    expect(t('mumbai time')?.value).toBe('5:30 PM');
    expect(t('time in PST')?.value).toBe('4:00 AM');
    expect(t('time sydney')?.value).toBe('11:00 PM');
    expect(t('time in Asia/Tokyo')?.value).toBe('9:00 PM');
    expect(t('time in são paulo')?.value).toBe('9:00 AM');
    expect(t('time in sf')?.expression).toBe('Time in SF');
  });

  it('describes the zone and the offset', () => {
    const a = t('time in tokyo');
    expect(a?.rows?.[0]?.value).toBe('Asia/Tokyo · UTC+9');
    expect(a?.caption).toContain('GMT+9');
    expect(a?.caption).toContain('ahead of you');
    expect(t('time in kolkata')?.rows?.[0]?.value).toBe('Asia/Kolkata · UTC+5:30');
  });

  it('gives the local time for plain "time"', () => {
    expect(t('time')).toMatchObject({ kind: 'time', expression: 'Local time' });
    expect(t('what time is it')?.kind).toBe('time');
  });

  it('does not answer for places it does not know', () => {
    expect(t('time in narnia')).toBeNull();
    expect(t('time management')).toBeNull();
    expect(t('the time machine')).toBeNull();
  });

  it('computes zone offsets, DST included', () => {
    expect(zoneOffsetMinutes('Asia/Kolkata', UTC_NOON)).toBe(330);
    expect(zoneOffsetMinutes('America/New_York', UTC_NOON)).toBe(-300); // EST in November
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe(-240); // EDT in July
  });
});

describe('colours', () => {
  it('turns hex and rgb()/hsl() into a swatch with every format', () => {
    const a = answer('#ff8800');
    expect(a).toMatchObject({ kind: 'color', value: '#FF8800', copy: '#ff8800', swatch: 'rgb(255 136 0)' });
    expect(a?.rows?.map((r) => r.label)).toEqual(['HEX', 'RGB', 'HSL', 'OKLCH']);
    expect(a?.rows?.[1]?.value).toBe('rgb(255 136 0)');
    expect(a?.rows?.[2]?.value).toBe('hsl(32 100% 50%)');
    expect(a?.rows?.[3]?.value).toMatch(/^oklch\(0\.\d+ 0\.\d+ \d+(\.\d)?\)$/);
    expect(answer('#f80')?.copy).toBe('#ff8800');
    expect(answer('rgb(255, 136, 0)')?.copy).toBe('#ff8800');
    expect(answer('hsl(32 100% 50%)')?.kind).toBe('color');
    expect(answer('#ff880080')?.copy).toBe('#ff880080');
  });

  it('needs a # or a function — plain words that happen to be hex stay words', () => {
    for (const q of ['bad', 'face', 'fab', 'ff8800', '#zzz', '#12', 'rgb(1,2)', 'rgb(a,b,c)']) expect(answer(q), q).toBeNull();
  });
});

describe('random things', () => {
  it('uuid, coin, dice, pick, number, password', () => {
    expect(answer('uuid')?.value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(answer('flip a coin')?.value).toMatch(/^(Heads|Tails)$/);
    expect(answer('coin flip')?.reroll).toBe(true);
    for (let i = 0; i < 50; i++) {
      const d = Number(answer('roll d20')?.value);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(20);
      const sum = Number(answer('2d6+3')?.value);
      expect(sum).toBeGreaterThanOrEqual(5);
      expect(sum).toBeLessThanOrEqual(15);
    }
    expect(answer('roll 3d8')?.caption).toMatch(/^\d+ \+ \d+ \+ \d+$/);
    expect(answer('pick pizza, sushi, tacos')?.value).toMatch(/^(pizza|sushi|tacos)$/);
    expect(answer('pick pizza or sushi')?.caption).toBe('pizza · sushi');
    expect(answer('pick lonely')).toBeNull();
    const n = Number(answer('random 5-8')?.value);
    expect(n >= 5 && n <= 8).toBe(true);
    expect(answer('password 24')?.value).toHaveLength(24);
    expect(answer('password')?.value).toHaveLength(20);
    expect(answer('password 500')?.value).toHaveLength(128);
    expect(answer('password 3')?.value).toHaveLength(6);
  });

  it('rolls fresh each time', () => {
    const seen = new Set(Array.from({ length: 12 }, () => answer('uuid')?.value));
    expect(seen.size).toBe(12);
  });

  it('is not triggered by ordinary words', () => {
    for (const q of ['coin', 'dice games', 'pickle', 'password manager', 'd', 'roll call', 'uuid generator']) {
      // "coin" alone is accepted on purpose; the rest must not be answers
      if (q === 'coin') continue;
      expect(answer(q), q).toBeNull();
    }
  });
});

describe('encoders', () => {
  it('base64, url and number bases', () => {
    expect(answer('base64 hello')).toMatchObject({ kind: 'encode', value: 'aGVsbG8=' });
    expect(answer('base64 decode aGVsbG8=')?.value).toBe('hello');
    expect(answer('b64 d aGVsbG8=')?.value).toBe('hello');
    expect(answer('base64 héllo ✓')?.value).toBe('aMOpbGxvIOKckw==');
    expect(answer('urlencode a b&c=d/é')?.value).toBe('a%20b%26c%3Dd%2F%C3%A9');
    expect(answer('urldecode a%20b%26c')?.value).toBe('a b&c');
    expect(answer('base64 decode ###')).toBeNull();
    expect(answer('255 to hex')).toMatchObject({ value: '0xFF' });
    expect(answer('0xff in decimal')?.value).toBe('255');
    expect(answer('10 to binary')?.value).toBe('0b1010');
  });
});

describe('intents', () => {
  it('parses durations', () => {
    expect(parseDuration('25')).toBe(25);
    expect(parseDuration('25m')).toBe(25);
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration('1 h 30 min')).toBe(90);
    expect(parseDuration('1.5 hours')).toBe(90);
    expect(parseDuration('90s')).toBe(1.5);
    expect(parseDuration('2 hours and 15 minutes')).toBe(135);
    expect(parseDuration('0')).toBeNull();
    expect(parseDuration('25 apples')).toBeNull();
    expect(parseDuration('99999')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });

  it('recognises timers in every phrasing', () => {
    for (const q of [
      'timer 25',
      'timer 25m',
      'timer for 25 minutes',
      '25 min timer',
      '25 minute timer',
      'set a timer for 25 min',
      'pomodoro 25 minutes',
      'set 25m timer',
    ]) {
      expect(parseIntent(q), q).toMatchObject({ kind: 'timer', minutes: 25, label: '25 min' });
    }
    expect(parseIntent('timer 1h30m')).toMatchObject({ minutes: 90, label: '1 h 30 min' });
    for (const q of ['timer', 'pomodoro', 'timer app', 'kitchen timer', 'timer 0']) expect(parseIntent(q), q).toBeNull();
  });

  it('recognises notes and tasks, and tells deliberate ones from guesses', () => {
    expect(parseIntent('note buy milk')).toEqual({ kind: 'note', text: 'buy milk', explicit: false });
    expect(parseIntent('note: buy milk')).toEqual({ kind: 'note', text: 'buy milk', explicit: true });
    expect(parseIntent('task fix the login bug')).toEqual({ kind: 'task', text: 'fix the login bug', explicit: false });
    expect(parseIntent('todo: call mom')).toEqual({ kind: 'task', text: 'call mom', explicit: true });
    expect(parseIntent('new note: x')).toMatchObject({ kind: 'note', explicit: true });
    for (const q of ['note', 'notes app', 'notebook', 'tasks', 'todoist', 'note:   ']) expect(parseIntent(q), q).toBeNull();
  });

  it('computeAnswer surfaces intents separately from answers', () => {
    expect(computeAnswer('timer 10', { now: NOW })).toEqual({ type: 'intent', intent: { kind: 'timer', minutes: 10, label: '10 min' } });
  });

  it('is not slowed down by pathological input', () => {
    const start = performance.now();
    computeAnswer(`timer ${'1'.repeat(38)}x`, { now: NOW });
    computeAnswer(`${'1 '.repeat(200)}timer`, { now: NOW });
    computeAnswer('(('.repeat(100), { now: NOW });
    expect(performance.now() - start).toBeLessThan(200);
  });
});
