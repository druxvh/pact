import { base64Decode, base64Encode, urlDecode, urlEncode } from '@/features/tools/lib/encode';
import type { Answer } from '@/lib/omnibox/types';

const BASE64 = /^(?:base64|b64)(?:\s+(encode|decode|enc|dec|e|d))?\s+([\s\S]+)$/i;
const UNBASE64 = /^(?:unbase64|base64decode|b64decode|decode64)\s+([\s\S]+)$/i;
const URL_ENC = /^(?:urlencode|url\s*encode|urlenc|encodeuri(?:component)?)\s+([\s\S]+)$/i;
const URL_DEC = /^(?:urldecode|url\s*decode|urldec|decodeuri(?:component)?)\s+([\s\S]+)$/i;
const BASE_CONV = /^(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d{1,15})\s+(?:in|to|as|into)\s+(hex|hexadecimal|bin|binary|oct|octal|dec|decimal)$/i;

const answer = (expression: string, value: string, rows?: Answer['rows']): Answer => ({ kind: 'encode', expression, value, copy: value, mono: true, rows });

/** Cheap, sync encoders: base64, URL encoding and number bases. */
export function encodeAnswer(input: string): Answer | null {
  const text = input.trim();
  if (!text || text.length > 2000) return null;

  const unb = UNBASE64.exec(text);
  if (unb) {
    const r = base64Decode(unb[1] ?? '');
    return r.ok ? answer('Base64 decode', r.value) : null;
  }
  const b = BASE64.exec(text);
  if (b) {
    const decode = /^d/i.test(b[1] ?? '');
    if (decode) {
      const r = base64Decode(b[2] ?? '');
      return r.ok ? answer('Base64 decode', r.value) : null;
    }
    return answer('Base64 encode', base64Encode(b[2] ?? ''));
  }
  const ue = URL_ENC.exec(text);
  if (ue) {
    const r = urlEncode(ue[1] ?? '');
    return r.ok ? answer('URL encode', r.value) : null;
  }
  const ud = URL_DEC.exec(text);
  if (ud) {
    const r = urlDecode(ud[1] ?? '');
    return r.ok ? answer('URL decode', r.value) : null;
  }

  const base = BASE_CONV.exec(text);
  if (base) {
    const raw = (base[1] ?? '').toLowerCase();
    const n = raw.startsWith('0x')
      ? Number.parseInt(raw.slice(2), 16)
      : raw.startsWith('0b')
        ? Number.parseInt(raw.slice(2), 2)
        : raw.startsWith('0o')
          ? Number.parseInt(raw.slice(2), 8)
          : Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    const rows = [
      { label: 'Decimal', value: String(n), copy: String(n) },
      { label: 'Hex', value: `0x${n.toString(16).toUpperCase()}`, copy: `0x${n.toString(16).toUpperCase()}` },
      { label: 'Binary', value: `0b${n.toString(2)}`, copy: `0b${n.toString(2)}` },
      { label: 'Octal', value: `0o${n.toString(8)}`, copy: `0o${n.toString(8)}` },
    ];
    const want = (base[2] ?? '').toLowerCase();
    const pickRow = want.startsWith('h') ? rows[1] : want.startsWith('b') ? rows[2] : want.startsWith('o') ? rows[3] : rows[0];
    return pickRow
      ? {
          ...answer(
            `${text.split(/\s+/)[0]} → ${pickRow.label.toLowerCase()}`,
            pickRow.value,
            rows.filter((r) => r !== pickRow),
          ),
        }
      : null;
  }
  return null;
}
