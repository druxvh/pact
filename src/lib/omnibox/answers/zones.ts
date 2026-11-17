import type { Answer } from '@/lib/omnibox/types';

/** Names people type that aren't an IANA city. The IANA list itself (`Asia/Tokyo` → "tokyo") is indexed on first use. */
const ALIASES: Record<string, string> = {
  nyc: 'America/New_York',
  'new york city': 'America/New_York',
  ny: 'America/New_York',
  la: 'America/Los_Angeles',
  'los angeles': 'America/Los_Angeles',
  sf: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'silicon valley': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  portland: 'America/Los_Angeles',
  'san diego': 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles',
  austin: 'America/Chicago',
  dallas: 'America/Chicago',
  houston: 'America/Chicago',
  'new orleans': 'America/Chicago',
  boston: 'America/New_York',
  miami: 'America/New_York',
  atlanta: 'America/New_York',
  washington: 'America/New_York',
  dc: 'America/New_York',
  philadelphia: 'America/New_York',
  montreal: 'America/Toronto',
  ottawa: 'America/Toronto',
  'mexico city': 'America/Mexico_City',
  'sao paulo': 'America/Sao_Paulo',
  'rio de janeiro': 'America/Sao_Paulo',
  rio: 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  bogota: 'America/Bogota',
  lima: 'America/Lima',
  santiago: 'America/Santiago',
  london: 'Europe/London',
  uk: 'Europe/London',
  england: 'Europe/London',
  britain: 'Europe/London',
  scotland: 'Europe/London',
  edinburgh: 'Europe/London',
  manchester: 'Europe/London',
  munich: 'Europe/Berlin',
  germany: 'Europe/Berlin',
  france: 'Europe/Paris',
  spain: 'Europe/Madrid',
  barcelona: 'Europe/Madrid',
  italy: 'Europe/Rome',
  milan: 'Europe/Rome',
  netherlands: 'Europe/Amsterdam',
  ireland: 'Europe/Dublin',
  portugal: 'Europe/Lisbon',
  switzerland: 'Europe/Zurich',
  geneva: 'Europe/Zurich',
  sweden: 'Europe/Stockholm',
  norway: 'Europe/Oslo',
  denmark: 'Europe/Copenhagen',
  finland: 'Europe/Helsinki',
  poland: 'Europe/Warsaw',
  greece: 'Europe/Athens',
  turkey: 'Europe/Istanbul',
  russia: 'Europe/Moscow',
  'st petersburg': 'Europe/Moscow',
  ukraine: 'Europe/Kyiv',
  kiev: 'Europe/Kyiv',
  india: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata', // engines list it under its old name, Asia/Calcutta
  calcutta: 'Asia/Kolkata',
  kathmandu: 'Asia/Kathmandu',
  'ho chi minh': 'Asia/Ho_Chi_Minh',
  'ho chi minh city': 'Asia/Ho_Chi_Minh',
  saigon: 'Asia/Ho_Chi_Minh',
  yangon: 'Asia/Yangon',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  'new delhi': 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  bengaluru: 'Asia/Kolkata',
  chennai: 'Asia/Kolkata',
  hyderabad: 'Asia/Kolkata',
  pune: 'Asia/Kolkata',
  pakistan: 'Asia/Karachi',
  bangladesh: 'Asia/Dhaka',
  'sri lanka': 'Asia/Colombo',
  nepal: 'Asia/Kathmandu',
  china: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai',
  shenzhen: 'Asia/Shanghai',
  'hong kong': 'Asia/Hong_Kong',
  hk: 'Asia/Hong_Kong',
  taiwan: 'Asia/Taipei',
  japan: 'Asia/Tokyo',
  osaka: 'Asia/Tokyo',
  kyoto: 'Asia/Tokyo',
  korea: 'Asia/Seoul',
  'south korea': 'Asia/Seoul',
  vietnam: 'Asia/Ho_Chi_Minh',
  hanoi: 'Asia/Bangkok',
  thailand: 'Asia/Bangkok',
  indonesia: 'Asia/Jakarta',
  philippines: 'Asia/Manila',
  malaysia: 'Asia/Kuala_Lumpur',
  uae: 'Asia/Dubai',
  'abu dhabi': 'Asia/Dubai',
  'saudi arabia': 'Asia/Riyadh',
  israel: 'Asia/Jerusalem',
  'tel aviv': 'Asia/Jerusalem',
  iran: 'Asia/Tehran',
  egypt: 'Africa/Cairo',
  'south africa': 'Africa/Johannesburg',
  'cape town': 'Africa/Johannesburg',
  nigeria: 'Africa/Lagos',
  kenya: 'Africa/Nairobi',
  australia: 'Australia/Sydney',
  canberra: 'Australia/Sydney',
  'new zealand': 'Pacific/Auckland',
  nz: 'Pacific/Auckland',
  wellington: 'Pacific/Auckland',
  hawaii: 'Pacific/Honolulu',
  utc: 'UTC',
  gmt: 'UTC',
  z: 'UTC',
  zulu: 'UTC',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  pt: 'America/Los_Angeles',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  mt: 'America/Denver',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  ct: 'America/Chicago',
  est: 'America/New_York',
  edt: 'America/New_York',
  et: 'America/New_York',
  bst: 'Europe/London',
  cet: 'Europe/Paris',
  cest: 'Europe/Paris',
  eet: 'Europe/Athens',
  ist: 'Asia/Kolkata',
  jst: 'Asia/Tokyo',
  kst: 'Asia/Seoul',
  sgt: 'Asia/Singapore',
  aest: 'Australia/Sydney',
  aedt: 'Australia/Sydney',
  nzst: 'Pacific/Auckland',
};

const LONG_ABBREVIATIONS = new Set(['aest', 'aedt', 'nzst', 'cest']);

const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.']/g, '').replace(/\s+/g, ' ').trim();

let iana: Map<string, string> | undefined;

function ianaIndex(): Map<string, string> {
  if (iana) return iana;
  const map = new Map<string, string>();
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    for (const tz of all) {
      map.set(strip(tz.replaceAll('_', ' ')), tz);
      const city = tz.split('/').pop() ?? '';
      const key = strip(city.replaceAll('_', ' '));
      if (key && !map.has(key)) map.set(key, tz);
    }
  } catch {
    /* an old engine: the alias table alone has to do */
  }
  iana = map;
  return map;
}

const isZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** "tokyo", "new york", "PST", "Asia/Tokyo" → an IANA zone and a friendly label; null when it isn't a place we know. */
export function resolveZone(raw: string): { tz: string; label: string } | null {
  const key = strip(raw.replace(/^the\s+/i, ''));
  if (!key || key.length > 40) return null;
  const tz = ALIASES[key] ?? ianaIndex().get(key) ?? (/^[a-z]+\/[a-z_/+-]+$/i.test(raw.trim()) ? raw.trim() : undefined);
  if (!tz || !isZone(tz)) return null;
  // "pst", "nyc", "uk" read better upper-cased; everything else is title-cased as typed
  const shout = key in ALIASES && (key.length <= 3 || LONG_ABBREVIATIONS.has(key));
  const label = shout ? key.toUpperCase() : raw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  return { tz, label };
}

/** Offset of `tz` from UTC at `at`, in minutes. */
export function zoneOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

const offsetLabel = (min: number) => {
  const sign = min < 0 ? '−' : '+';
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
};

const hoursLabel = (diffMin: number) => {
  if (diffMin === 0) return 'same time as you';
  const abs = Math.abs(diffMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const span = `${h}h${m ? ` ${m}m` : ''}`;
  return `${span} ${diffMin > 0 ? 'ahead of' : 'behind'} you`;
};

export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The card for a clock reading in `tz`. */
export function timeCard(expression: string, tz: string, label: string | null, now: Date, locale?: string): Answer {
  const time = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(now);
  const day = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(now);
  const abbr = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  const offset = zoneOffsetMinutes(tz, now);
  const mine = zoneOffsetMinutes(localZone(), now);
  const isLocal = label === null;
  return {
    kind: 'time',
    expression,
    value: time,
    copy: time,
    caption: isLocal ? `${day} · ${abbr}` : `${day} · ${abbr} · ${hoursLabel(offset - mine)}`,
    rows: [{ label: 'Time zone', value: `${tz.replaceAll('_', ' ')} · ${offsetLabel(offset)}`, copy: tz }],
  };
}

const LOCAL_TIME = /^(?:time|time now|now|current time|what\s+time\s+is\s+it(?:\s+now)?|what's\s+the\s+time)\??$/i;
const TIME_IN = /^(?:what(?:'s|\s+is)\s+(?:the\s+)?)?(?:current\s+)?time(?:\s+is\s+it)?\s+(?:in|at|for)\s+(.+?)\??$/i;
const TIME_PLACE = /^(?:current\s+)?time\s+(.+?)\??$/i;
const PLACE_TIME = /^(.+?)\s+(?:current\s+)?time\??$/i;
const WHAT_TIME_IN = /^what\s+time\s+is\s+it\s+(?:in|at)\s+(.+?)\??$/i;

/** `time`, `time in tokyo`, `new york time`, `what time is it in london`, `pst time`. */
export function timeAnswer(input: string, now: Date, locale?: string): Answer | null {
  const text = input.trim();
  if (!text || text.length > 60) return null;
  if (LOCAL_TIME.test(text)) return timeCard('Local time', localZone(), null, now, locale);
  const place = (WHAT_TIME_IN.exec(text) ?? TIME_IN.exec(text) ?? TIME_PLACE.exec(text) ?? PLACE_TIME.exec(text))?.[1];
  if (!place) return null;
  const zone = resolveZone(place);
  return zone ? timeCard(`Time in ${zone.label}`, zone.tz, zone.label, now, locale) : null;
}
