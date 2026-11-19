import { describe, expect, it } from 'vitest';
import { appendToDraft, describeWhere, MAX_CAPTURE_CHARS, MAX_TASK_TITLE, pickId, splitTask } from './capture';

describe('splitTask', () => {
  it('first line is the title, the rest the description', () => {
    expect(splitTask('Buy milk')).toEqual({ title: 'Buy milk', description: '' });
    expect(splitTask('  Buy milk\n\nOat, 2 litres\nand eggs  ')).toEqual({ title: 'Buy milk', description: 'Oat, 2 litres\nand eggs' });
    expect(splitTask('a\r\nb')).toEqual({ title: 'a', description: 'b' });
  });

  it('trims a very long first line for the title but keeps every word in the description', () => {
    const long = 'word '.repeat(80).trim();
    const out = splitTask(long);
    expect(out.title.length).toBeLessThanOrEqual(MAX_TASK_TITLE);
    expect(out.title.endsWith('…')).toBe(true);
    expect(out.description).toBe(long);
  });
});

describe('appendToDraft', () => {
  it('starts a draft, or adds below what is there with a blank line between', () => {
    expect(appendToDraft('', ' hello ')).toBe('hello');
    expect(appendToDraft('   \n', 'hello')).toBe('hello');
    expect(appendToDraft('first\n\n', 'second')).toBe('first\n\nsecond');
  });

  it('refuses rather than cutting someone’s text short', () => {
    expect(appendToDraft('x'.repeat(MAX_CAPTURE_CHARS - 3), 'abc')).toBeNull();
    expect(appendToDraft('x'.repeat(MAX_CAPTURE_CHARS - 5), 'abc')).not.toBeNull();
  });
});

describe('pickId', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  it('takes the first candidate that exists, else the first item, else null', () => {
    expect(pickId(items, 'b', 'a')).toBe('b');
    expect(pickId(items, 'gone', null, 'a')).toBe('a');
    expect(pickId(items, 'gone', undefined)).toBe('a');
    expect(pickId([], 'a')).toBeNull();
  });
});

describe('describeWhere', () => {
  it('says where it landed', () => {
    expect(describeWhere({ notebook: 'Personal' })).toBe('Notes · Personal');
    expect(describeWhere({ board: 'Work', column: 'To do' })).toBe('Kanban · Work · To do');
    expect(describeWhere({ home: true })).toBe('Home · Quick note');
  });
});
