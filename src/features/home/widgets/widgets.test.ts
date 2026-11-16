import { describe, expect, it } from 'vitest';
import type { Task } from '@/features/kanban/store';
import { preview, splitNote } from './noteText';
import { dayNumber, QUOTES, quoteOfTheDay } from './quotes';
import { bucketOf, dateKey, todayTasks } from './today';

const task = (over: Partial<Task> & { id: string }): Task => ({
  boardId: 'b',
  columnId: 'todo',
  number: 1,
  title: over.id,
  description: '',
  assigneeId: null,
  priority: 'none',
  due: null,
  order: 1000,
  createdAt: '',
  updatedAt: '',
  completedAt: null,
  ...over,
});

describe('dateKey', () => {
  it('is the local calendar date, zero-padded', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dateKey(new Date(2026, 10, 16, 0, 0))).toBe('2026-11-16');
  });
});

describe('todayTasks', () => {
  const today = '2026-11-16';

  it('buckets by due date, then column', () => {
    expect(bucketOf(task({ id: 'a', due: '2026-11-10' }), today)).toBe('overdue');
    expect(bucketOf(task({ id: 'a', due: today }), today)).toBe('today');
    expect(bucketOf(task({ id: 'a', columnId: 'in_progress' }), today)).toBe('progress');
    expect(bucketOf(task({ id: 'a', due: '2026-12-01' }), today)).toBe('upnext');
    expect(bucketOf(task({ id: 'a' }), today)).toBe('upnext');
  });

  it('orders overdue → today → in progress → up next, then priority', () => {
    const { items } = todayTasks(
      [
        task({ id: 'later', priority: 'high' }),
        task({ id: 'wip', columnId: 'in_progress' }),
        task({ id: 'due-today-low', due: today, priority: 'low' }),
        task({ id: 'overdue', due: '2026-11-01' }),
        task({ id: 'due-today-high', due: today, priority: 'high' }),
      ],
      today,
    );
    expect(items.map((i) => i.task.id)).toEqual(['overdue', 'due-today-high', 'due-today-low', 'wip', 'later']);
  });

  it('never includes finished tasks, and counts the unfinished ones', () => {
    const { items, open } = todayTasks([task({ id: 'x', columnId: 'done', due: '2026-11-01' }), task({ id: 'y' })], today);
    expect(items.map((i) => i.task.id)).toEqual(['y']);
    expect(open).toBe(1);
  });

  it('caps the list but still reports how many are open', () => {
    const many = Array.from({ length: 12 }, (_, i) => task({ id: `t${i}`, order: i }));
    const { items, open } = todayTasks(many, today, 4);
    expect(items).toHaveLength(4);
    expect(open).toBe(12);
  });

  it('is empty when there is nothing to do', () => {
    expect(todayTasks([], today)).toEqual({ items: [], open: 0 });
  });
});

describe('quoteOfTheDay', () => {
  it('is stable within a day and changes on the next', () => {
    const morning = new Date(2026, 10, 16, 6, 0);
    const night = new Date(2026, 10, 16, 23, 30);
    const tomorrow = new Date(2026, 10, 17, 6, 0);
    expect(quoteOfTheDay(morning)).toBe(quoteOfTheDay(night));
    expect(quoteOfTheDay(tomorrow)).not.toBe(quoteOfTheDay(morning));
  });

  it('cycles through every quote before repeating', () => {
    const start = new Date(2026, 0, 1, 12);
    const seen = new Set(Array.from({ length: QUOTES.length }, (_, i) => quoteOfTheDay(new Date(2026, 0, 1 + i, 12))));
    expect(seen.size).toBe(QUOTES.length);
    expect(quoteOfTheDay(new Date(2026, 0, 1 + QUOTES.length, 12))).toBe(quoteOfTheDay(start));
  });

  it('handles dates before 1970 without a negative index', () => {
    expect(QUOTES).toContain(quoteOfTheDay(new Date(1960, 5, 1)));
    expect(dayNumber(new Date(1969, 11, 31, 12))).toBe(-1);
  });

  it('every quote is non-empty and attributed', () => {
    for (const q of QUOTES) {
      expect(q.text.length).toBeGreaterThan(10);
      expect(q.by.length).toBeGreaterThan(2);
    }
    expect(new Set(QUOTES.map((q) => q.text)).size).toBe(QUOTES.length);
  });
});

describe('splitNote', () => {
  it('makes a short first line the title and the rest the body', () => {
    expect(splitNote('Ideas for the launch\nmention accents\n\nand wallpapers')).toEqual({
      title: 'Ideas for the launch',
      body: 'mention accents\n\nand wallpapers',
    });
  });
  it('a single short line is just a title', () => {
    expect(splitNote('  Buy milk  ')).toEqual({ title: 'Buy milk', body: '' });
  });
  it('strips a leading markdown heading mark from the title', () => {
    expect(splitNote('## Plan\nstep one').title).toBe('Plan');
  });
  it('trims a long first line for the title but keeps the full text', () => {
    const long = `${'word '.repeat(30)}end`;
    const out = splitNote(long);
    expect(out.title.length).toBeLessThanOrEqual(60);
    expect(out.title.endsWith('…')).toBe(true);
    expect(out.body).toBe(long.trim());
  });
  it('copes with Windows line endings', () => {
    expect(splitNote('Title\r\nBody')).toEqual({ title: 'Title', body: 'Body' });
  });
});

describe('preview', () => {
  it('uses the first non-empty line without list or heading marks', () => {
    expect(preview('\n\n# Heading')).toBe('Heading');
    expect(preview('- [ ] call mum')).toBe('call mum');
    expect(preview('1. first step')).toBe('first step');
    expect(preview('> a **bold** `claim`')).toBe('a bold claim');
  });
  it('caps the length and handles empty bodies', () => {
    expect(preview('x'.repeat(200))).toHaveLength(90);
    expect(preview('')).toBe('');
  });
});
