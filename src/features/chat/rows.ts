import type { Message } from '@/features/chat/types';
import { ME_ID } from '@/store/useUserStore';

const FIVE_MIN = 5 * 60_000;

/** Where a bubble sits in a run of consecutive messages from one sender. */
export type RunPosition = 'single' | 'first' | 'middle' | 'last';

export type Row =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'msg'; key: string; m: Message; position: RunPosition; showName: boolean };

export function dayLabel(d: Date, now = new Date()): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** Insert date separators and work out each bubble's place in a run of same-sender messages. */
export function buildRows(msgs: Message[], isGroup: boolean): Row[] {
  const rows: Row[] = [];
  let prevDay = '';
  msgs.forEach((m, i) => {
    const d = new Date(m.createdAt);
    const day = d.toDateString();
    if (day !== prevDay) {
      rows.push({ kind: 'date', key: `d-${day}`, label: dayLabel(d) });
      prevDay = day;
    }
    const prev = msgs[i - 1];
    const next = msgs[i + 1];
    const joins = (a: Message | undefined, b: Message | undefined) =>
      Boolean(a && b && a.senderId === b.senderId && new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString() && Math.abs(+new Date(b.createdAt) - +new Date(a.createdAt)) < FIVE_MIN);
    const up = joins(prev, m);
    const down = joins(m, next);
    rows.push({
      kind: 'msg',
      key: m.id,
      m,
      position: up && down ? 'middle' : up ? 'last' : down ? 'first' : 'single',
      showName: isGroup && m.senderId !== ME_ID && !up,
    });
  });
  return rows;
}

