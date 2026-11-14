import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD_ID,
  columnTasks,
  describeDue,
  orderBetween,
  toDateKey,
  useKanbanStore,
} from '@/features/kanban/store';

const reset = () =>
  useKanbanStore.setState({
    tasks: [],
    boards: [{ id: DEFAULT_BOARD_ID, name: 'Personal', memberIds: ['local-user'], nextNumber: 1, createdAt: new Date().toISOString() }],
    activeBoardId: DEFAULT_BOARD_ID,
  });

const order = (col: 'todo' | 'in_progress' | 'done') =>
  columnTasks(useKanbanStore.getState().tasks, DEFAULT_BOARD_ID, col).map((t) => t.title);

describe('orderBetween (fractional indexing)', () => {
  it('lands strictly between neighbours', () => {
    expect(orderBetween(undefined, undefined)).toBe(1000);
    expect(orderBetween(1000, 2000)).toBe(1500);
    expect(orderBetween(1000, undefined)).toBe(2000);
    expect(orderBetween(undefined, 1000)).toBe(0);
  });
});

describe('kanban store', () => {
  beforeEach(reset);

  it('appends tasks in order and never reuses #numbers after a delete', () => {
    const s = useKanbanStore.getState();
    const a = s.addTask(DEFAULT_BOARD_ID, 'todo', 'A');
    const b = s.addTask(DEFAULT_BOARD_ID, 'todo', 'B');
    expect(useKanbanStore.getState().tasks.find((t) => t.id === b)?.number).toBe(2);
    useKanbanStore.getState().deleteTask(b);
    const c = useKanbanStore.getState().addTask(DEFAULT_BOARD_ID, 'todo', 'C');
    expect(useKanbanStore.getState().tasks.find((t) => t.id === c)?.number).toBe(3); // not 2 again
    expect(order('todo')).toEqual(['A', 'C']);
    expect(a).toBeTruthy();
  });

  it('moves a card DOWN one slot within a column — the bug the old board had', () => {
    const s = useKanbanStore.getState();
    const [a] = ['A', 'B', 'C'].map((t) => s.addTask(DEFAULT_BOARD_ID, 'todo', t));
    useKanbanStore.getState().moveTask(a as string, 'todo', 1); // A below B
    expect(order('todo')).toEqual(['B', 'A', 'C']);
    useKanbanStore.getState().moveTask(a as string, 'todo', 2); // A to the end
    expect(order('todo')).toEqual(['B', 'C', 'A']);
  });

  it('moves up, across columns, and into an empty column', () => {
    const s = useKanbanStore.getState();
    const [a, b, c] = ['A', 'B', 'C'].map((t) => s.addTask(DEFAULT_BOARD_ID, 'todo', t)) as [string, string, string];
    useKanbanStore.getState().moveTask(c, 'todo', 0);
    expect(order('todo')).toEqual(['C', 'A', 'B']);
    useKanbanStore.getState().moveTask(a, 'in_progress', 0);
    expect(order('in_progress')).toEqual(['A']);
    expect(order('todo')).toEqual(['C', 'B']);
    useKanbanStore.getState().moveTask(b, 'in_progress', 0);
    expect(order('in_progress')).toEqual(['B', 'A']);
  });

  it('tracks completion when moving to / from Done', () => {
    const id = useKanbanStore.getState().addTask(DEFAULT_BOARD_ID, 'todo', 'X');
    useKanbanStore.getState().moveTask(id, 'done', 0);
    expect(useKanbanStore.getState().tasks[0]?.completedAt).toBeTruthy();
    useKanbanStore.getState().moveTask(id, 'todo', 0);
    expect(useKanbanStore.getState().tasks[0]?.completedAt).toBeNull();
  });

  it('survives hundreds of reorders without precision collapse', () => {
    const s = useKanbanStore.getState();
    const ids = Array.from({ length: 6 }, (_, i) => s.addTask(DEFAULT_BOARD_ID, 'todo', `T${i}`));
    // keep dropping the last card at index 1 — halves the gap each time
    for (let i = 0; i < 200; i++) {
      const last = columnTasks(useKanbanStore.getState().tasks, DEFAULT_BOARD_ID, 'todo').at(-1);
      if (last) useKanbanStore.getState().moveTask(last.id, 'todo', 1);
    }
    const orders = columnTasks(useKanbanStore.getState().tasks, DEFAULT_BOARD_ID, 'todo').map((t) => t.order);
    expect(new Set(orders).size).toBe(ids.length); // all distinct
    expect([...orders].sort((x, y) => x - y)).toEqual(orders); // still strictly ordered
  });

  it('refuses to delete the last board and returns a snapshot that restores', () => {
    expect(useKanbanStore.getState().deleteBoard(DEFAULT_BOARD_ID)).toBeNull();
    const second = useKanbanStore.getState().createBoard('Sprint');
    useKanbanStore.getState().addTask(second, 'todo', 'in sprint');
    const snap = useKanbanStore.getState().deleteBoard(second);
    expect(snap?.tasks).toHaveLength(1);
    expect(useKanbanStore.getState().boards).toHaveLength(1);
    expect(useKanbanStore.getState().tasks).toHaveLength(0);
    useKanbanStore.getState().restoreBoard(snap as NonNullable<typeof snap>);
    expect(useKanbanStore.getState().boards).toHaveLength(2);
    expect(useKanbanStore.getState().tasks).toHaveLength(1);
  });

  it('unassigns tasks when a member is removed', () => {
    const inv = useKanbanStore.getState().inviteToBoard(DEFAULT_BOARD_ID, '@Alex');
    expect(inv).toMatchObject({ ok: true, personId: 'alex' });
    const id = useKanbanStore.getState().addTask(DEFAULT_BOARD_ID, 'todo', 'X', { assigneeId: 'alex' });
    expect(useKanbanStore.getState().inviteToBoard(DEFAULT_BOARD_ID, 'alex').ok).toBe(false); // duplicate
    useKanbanStore.getState().removeMember(DEFAULT_BOARD_ID, 'alex');
    expect(useKanbanStore.getState().tasks.find((t) => t.id === id)?.assigneeId).toBeNull();
  });

  it('migrates the v1 persisted shape (no order / priority / counters)', () => {
    const migrate = useKanbanStore.persist.getOptions().migrate;
    const out = migrate?.(
      {
        activeBoardId: 'board-2',
        boards: [{ id: 'board-2', name: 'jam', memberIds: ['local-user'], createdAt: '2026-01-01' }],
        tasks: [
          { id: 'a', boardId: 'board-2', columnId: 'todo', number: 1, title: 'one', createdAt: '2026-01-01' },
          { id: 'b', boardId: 'board-2', columnId: 'todo', number: 4, title: 'two', createdAt: '2026-01-01' },
          { id: 'c', boardId: 'board-2', columnId: 'done', number: 2, title: 'three', createdAt: '2026-01-01' },
        ],
      },
      1,
    ) as ReturnType<typeof useKanbanStore.getState>;
    expect(out.boards[0]?.nextNumber).toBe(5);
    expect(out.tasks.map((t) => t.order)).toEqual([1000, 2000, 1000]);
    expect(out.tasks[2]?.completedAt).toBeTruthy();
    expect(out.tasks[0]).toMatchObject({ priority: 'none', due: null, description: '' });
  });
});

describe('due dates', () => {
  const today = new Date(2026, 10, 14); // Sat 14 Nov 2026
  it('labels and tones', () => {
    expect(describeDue('2026-11-14', false, today)).toEqual({ label: 'Today', tone: 'soon' });
    expect(describeDue('2026-11-15', false, today)).toEqual({ label: 'Tomorrow', tone: 'soon' });
    expect(describeDue('2026-11-13', false, today)).toEqual({ label: 'Yesterday', tone: 'overdue' });
    expect(describeDue('2026-11-20', false, today).tone).toBe('later');
    expect(describeDue('2026-12-25', false, today).label).toMatch(/Dec/);
  });
  it('never marks completed tasks as overdue', () => {
    expect(describeDue('2026-01-01', true, today).tone).toBe('later');
  });
  it('toDateKey is zero-padded local date', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
