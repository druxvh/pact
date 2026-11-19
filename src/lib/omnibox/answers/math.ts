import { evaluate, formatResult, plainResult } from '@/features/tools/lib/calc';
import type { Answer } from '@/lib/omnibox/types';

const FUNCTION_WORDS = /\b(sqrt|cbrt|sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|ln|log|log2|exp|abs|floor|ceil|round|trunc|fact|pow|min|max|hypot)\b/i;
const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const PERCENT_OF = new RegExp(String.raw`^(?:what\s+is\s+|what's\s+)?${NUM}\s*%\s*of\s+(.+)$`, 'i');
const PERCENT_OFF = new RegExp(String.raw`^${NUM}\s*%\s*off\s+(.+)$`, 'i');
const PERCENT_ADD = new RegExp(String.raw`^(.+?)\s*([+-])\s*${NUM}\s*%$`);
// Things that merely look like arithmetic: 2026-12-25, 10-10-2020, 555-1234.
const LOOKS_LIKE_DATE_OR_ID = /^\d{1,4}([-/.])\d{1,4}(\1\d{1,4})?$/;
const PLAIN_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

const answer = (expression: string, n: number): Answer | null => {
  if (!Number.isFinite(n)) return null;
  return { kind: 'math', expression, value: formatResult(n), copy: plainResult(n) };
};

const num = (s: string | undefined): number => Number.parseFloat(s ?? '');

/**
 * Bare maths (`12*(3+4)/2`, `sqrt(144)`), `= …` and the percentage phrasings people actually type:
 * `15% of 240`, `20% off 80`, `240 + 15%` (which means 240 × 1.15, not 240.15).
 * Returns null for anything that isn't clearly a calculation, so ordinary searches are never hijacked.
 */
export function mathAnswer(input: string): Answer | null {
  let text = input.trim();
  if (!text || text.length > 160) return null;
  const forced = text.startsWith('=');
  if (forced) text = text.slice(1).trim();
  text = text.replace(/\s*=\s*$/, '');
  if (!text) return null;

  const of = PERCENT_OF.exec(text);
  if (of) {
    const base = evaluate(of[2] ?? '');
    return base.ok ? answer(input.trim(), (num(of[1]) / 100) * base.value) : null;
  }
  const off = PERCENT_OFF.exec(text);
  if (off) {
    const base = evaluate(off[2] ?? '');
    return base.ok ? answer(input.trim(), base.value * (1 - num(off[1]) / 100)) : null;
  }
  const add = PERCENT_ADD.exec(text);
  if (add && !/[%]/.test(add[1] ?? '')) {
    const base = evaluate(add[1] ?? '');
    if (base.ok) return answer(input.trim(), base.value * (1 + (add[2] === '-' ? -1 : 1) * (num(add[3]) / 100)));
  }

  if (!forced) {
    if (!/\d/.test(text)) return null;
    if (PLAIN_NUMBER.test(text) || LOOKS_LIKE_DATE_OR_ID.test(text)) return null;
    if (!/[-+*/^%!×÷()√π]/.test(text) && !FUNCTION_WORDS.test(text)) return null;
  }
  const r = evaluate(text);
  if (!r.ok) return null;
  return answer(input.trim(), r.value);
}
