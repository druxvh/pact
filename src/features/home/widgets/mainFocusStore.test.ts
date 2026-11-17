import { beforeEach, describe, expect, it } from 'vitest';
import { entryFor, streak } from '@/features/home/widgets/mainFocus';
import { MAIN_FOCUS_KEY, startFocusSession, useMainFocusStore } from '@/features/home/widgets/mainFocusStore';
import { useTimerStore } from '@/features/timer/store';
import { useNavStore } from '@/store/useNavStore';

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h);

beforeEach(() => {
  useMainFocusStore.setState({ entries: [] });
  useTimerStore.setState(useTimerStore.getInitialState(), true);
  useNavStore.setState({ section: 'home', sub: null });
});

describe('main focus store', () => {
  it('sets and checks off today’s focus, and keeps it on disk', () => {
    const { setToday, toggleToday } = useMainFocusStore.getState();
    setToday('Write the outline', at(2026, 11, 17));
    toggleToday(at(2026, 11, 17, 17));
    const entry = entryFor(useMainFocusStore.getState().entries, '2026-11-17');
    expect(entry?.text).toBe('Write the outline');
    expect(entry?.doneAt).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(MAIN_FOCUS_KEY) ?? '{}').state.entries).toHaveLength(1);
  });

  it('keeps each day separate and builds a streak across days', () => {
    const s = useMainFocusStore.getState();
    for (const d of [15, 16, 17]) {
      s.setToday(`Day ${d}`, at(2026, 11, d));
      s.toggleToday(at(2026, 11, d, 20));
    }
    expect(useMainFocusStore.getState().entries).toHaveLength(3);
    expect(streak(useMainFocusStore.getState().entries, '2026-11-17')).toBe(3);
  });

  it('a new day starts empty even though yesterday’s entry is still stored', () => {
    const s = useMainFocusStore.getState();
    s.setToday('Yesterday’s thing', at(2026, 11, 16));
    expect(entryFor(useMainFocusStore.getState().entries, '2026-11-17')).toBeNull();
    s.setToday('Today’s thing', at(2026, 11, 17));
    expect(useMainFocusStore.getState().entries.map((e) => e.text)).toEqual(['Yesterday’s thing', 'Today’s thing']);
  });

  it('clearing the text removes the day; checking off a day with no focus does nothing', () => {
    const s = useMainFocusStore.getState();
    s.toggleToday(at(2026, 11, 17));
    expect(useMainFocusStore.getState().entries).toEqual([]);
    s.setToday('x', at(2026, 11, 17));
    s.setToday('  ', at(2026, 11, 17));
    expect(useMainFocusStore.getState().entries).toEqual([]);
  });

  it('reads a damaged stored value without breaking', async () => {
    localStorage.setItem(
      MAIN_FOCUS_KEY,
      JSON.stringify({
        state: {
          entries: [
            { day: 'nope', text: 'x' },
            { day: '2026-11-17', text: 'ok' },
          ],
        },
        version: 1,
      }),
    );
    await useMainFocusStore.persist.rehydrate();
    expect(useMainFocusStore.getState().entries).toEqual([{ day: '2026-11-17', text: 'ok', doneAt: null }]);
  });
});

describe('startFocusSession', () => {
  it('sets the timer’s intent, makes sure it is on a focus round, and opens the timer', () => {
    useTimerStore.setState({ phase: 'short', status: 'idle', intent: '' });
    startFocusSession('Write the outline');
    const t = useTimerStore.getState();
    expect(t.intent).toBe('Write the outline');
    expect(t.phase).toBe('focus');
    expect(useNavStore.getState().section).toBe('timer');
  });

  it('never disturbs a session that is already running — it only opens the timer', () => {
    useTimerStore.setState({ intent: 'Existing', status: 'running', endsAt: Date.now() + 60_000 });
    startFocusSession('Something else');
    expect(useTimerStore.getState().intent).toBe('Existing');
    expect(useNavStore.getState().section).toBe('timer');
  });
});
