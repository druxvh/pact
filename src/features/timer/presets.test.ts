import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRESETS, emojiOf, MAX_PRESETS, PRESET_MAX_MINUTES, resolveIcon, sanitizePreset } from '@/features/timer/presets';
import { activePreset, useTimerStore } from '@/features/timer/store';

const reset = () => {
  localStorage.clear();
  useTimerStore.setState({
    phase: 'focus',
    status: 'idle',
    durations: { focus: 25, short: 5, long: 15 },
    endsAt: null,
    remainingMs: 25 * 60_000,
    cycle: 0,
    presets: DEFAULT_PRESETS,
    activePresetId: null,
    sessions: [],
    lastCompleted: null,
  });
};

describe('sanitizePreset', () => {
  it('trims, caps and rounds', () => {
    expect(sanitizePreset({ id: 'a', name: '  Deep   work  ', icon: 'brain', minutes: 49.6 })).toEqual({
      id: 'a',
      name: 'Deep work',
      icon: 'brain',
      minutes: 50,
    });
    expect(sanitizePreset({ id: 'a', name: 'x'.repeat(80), icon: 'brain', minutes: 5000 })?.minutes).toBe(PRESET_MAX_MINUTES);
    expect(sanitizePreset({ id: 'a', name: 'x'.repeat(80), icon: 'brain', minutes: 0 })?.name).toHaveLength(24);
  });
  it('rejects nameless timers and falls back to a safe icon', () => {
    expect(sanitizePreset({ id: 'a', name: '   ', icon: 'brain', minutes: 5 })).toBeNull();
    expect(sanitizePreset({ id: 'a', name: 'x', icon: 'not-an-icon', minutes: 5 })?.icon).toBe('timer');
    expect(sanitizePreset({ id: 'a', name: 'x', icon: 'emoji:abc', minutes: 5 })?.icon).toBe('timer');
    expect(sanitizePreset({ id: 'a', name: 'x', icon: 'emoji:🍵 extra', minutes: 5 })?.icon).toBe('emoji:🍵');
  });
});

describe('icons', () => {
  it('only accepts real emoji', () => {
    expect(emojiOf('🍵')).toBe('🍵');
    expect(emojiOf('👨‍👩‍👧 family')).toBe('👨‍👩‍👧');
    expect(emojiOf('a')).toBeNull();
    expect(emojiOf('')).toBeNull();
  });
  it('resolves unknown icons to the default timer glyph', () => {
    expect(resolveIcon('nope').kind).toBe('lucide');
    expect(resolveIcon('emoji:🍵')).toEqual({ kind: 'emoji', emoji: '🍵' });
  });
});

describe('custom timers in the store', () => {
  beforeEach(reset);

  it('applyPreset sets the focus length and the idle dial', () => {
    useTimerStore.getState().applyPreset('preset-deep');
    const s = useTimerStore.getState();
    expect(s.durations.focus).toBe(50);
    expect(s.remainingMs).toBe(50 * 60_000);
    expect(activePreset(s)?.name).toBe('Deep work');
  });

  it('does not switch while a timer is running', () => {
    useTimerStore.getState().start();
    useTimerStore.getState().applyPreset('preset-deep');
    expect(useTimerStore.getState().durations.focus).toBe(25);
  });

  it('changing the focus length by hand drops the active timer', () => {
    useTimerStore.getState().applyPreset('preset-deep');
    useTimerStore.getState().setDurations({ focus: 40 });
    expect(activePreset(useTimerStore.getState())).toBeUndefined();
  });

  it('saves new timers, edits in place, and removes them', () => {
    const id = useTimerStore.getState().savePreset({ name: 'Tea', icon: 'emoji:🍵', minutes: 4 });
    expect(id).toBeTruthy();
    expect(useTimerStore.getState().presets.at(-1)).toMatchObject({ name: 'Tea', minutes: 4 });
    useTimerStore.getState().savePreset({ id: id as string, name: 'Green tea', icon: 'emoji:🍵', minutes: 3 });
    expect(useTimerStore.getState().presets.filter((p) => p.id === id)).toHaveLength(1);
    expect(useTimerStore.getState().presets.find((p) => p.id === id)?.name).toBe('Green tea');
    useTimerStore.getState().applyPreset(id as string);
    useTimerStore.getState().removePreset(id as string);
    expect(useTimerStore.getState().activePresetId).toBeNull();
    expect(useTimerStore.getState().presets.find((p) => p.id === id)).toBeUndefined();
  });

  it('editing the timer in use re-points the idle dial', () => {
    useTimerStore.getState().applyPreset('preset-read');
    useTimerStore.getState().savePreset({ id: 'preset-read', name: 'Reading', icon: 'book', minutes: 45 });
    const s = useTimerStore.getState();
    expect(s.durations.focus).toBe(45);
    expect(s.remainingMs).toBe(45 * 60_000);
    expect(activePreset(s)?.id).toBe('preset-read');
  });

  it('caps the list and refuses unusable input', () => {
    for (let i = 0; useTimerStore.getState().presets.length < MAX_PRESETS; i++)
      useTimerStore.getState().savePreset({ name: `T${i}`, icon: 'timer', minutes: 5 });
    expect(useTimerStore.getState().savePreset({ name: 'One too many', icon: 'timer', minutes: 5 })).toBeNull();
    useTimerStore.getState().removePreset('preset-deep');
    expect(useTimerStore.getState().savePreset({ name: '   ', icon: 'timer', minutes: 5 })).toBeNull();
  });

  it('records which timer a finished focus session ran under', () => {
    useTimerStore.getState().applyPreset('preset-sprint');
    useTimerStore.getState().start();
    useTimerStore.setState({ endsAt: Date.now() - 1 });
    useTimerStore.getState().complete();
    expect(useTimerStore.getState().sessions[0]).toMatchObject({ minutes: 10, presetId: 'preset-sprint' });
  });
});
