import { colorAnswer } from '@/lib/omnibox/answers/colors';
import { dateAnswer } from '@/lib/omnibox/answers/dates';
import { encodeAnswer } from '@/lib/omnibox/answers/encode';
import { type Intent, parseIntent } from '@/lib/omnibox/answers/intents';
import { mathAnswer } from '@/lib/omnibox/answers/math';
import { randomAnswer } from '@/lib/omnibox/answers/random';
import { convertAnswer } from '@/lib/omnibox/answers/units';
import { timeAnswer } from '@/lib/omnibox/answers/zones';
import type { Answer } from '@/lib/omnibox/types';

export type { Intent } from '@/lib/omnibox/answers/intents';
export { describeMinutes, parseDuration, parseIntent } from '@/lib/omnibox/answers/intents';

export type Computed = { type: 'answer'; answer: Answer } | { type: 'intent'; intent: Intent };

/**
 * What, if anything, does this text *compute*? Most specific parsers first; each one only fires on text that is
 * unmistakably its own kind (`15% of 240`, `10 km in mi`, `time in tokyo`) so an ordinary search is never hijacked.
 * Offline and synchronous — it runs on every keystroke.
 */
export function computeAnswer(query: string, opts: { now?: Date; locale?: string } = {}): Computed | null {
  const q = query.trim();
  if (!q || q.length > 500) return null;
  const now = opts.now ?? new Date();

  const intent = parseIntent(q);
  if (intent) return { type: 'intent', intent };

  const answer =
    randomAnswer(q) ??
    encodeAnswer(q) ??
    colorAnswer(q) ??
    timeAnswer(q, now, opts.locale) ??
    dateAnswer(q, now, opts.locale) ??
    convertAnswer(q) ??
    mathAnswer(q);
  return answer ? { type: 'answer', answer } : null;
}
