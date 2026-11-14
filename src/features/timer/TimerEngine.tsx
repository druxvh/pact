import { useEffect, useRef } from 'react';
import { baseTitle } from '@/app/routes';
import { useKanbanStore } from '@/features/kanban/store';
import { type Completion, PHASE_LABEL, useTimerStore } from '@/features/timer/store';
import { clearAlarm, scheduleAlarm } from '@/lib/ext';
import { formatClock } from '@/lib/format';
import { playChime } from '@/lib/sound';
import { notify } from '@/lib/toast';
import { useNavStore } from '@/store/useNavStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';

export const ALARM_PREFIX = 'pact-timer:';

/**
 * Finish the running phase exactly once, even with several pact tabs open.
 * A Web Lock serialises tabs; inside it we re-read the persisted state, so the
 * second tab sees "already completed" and bows out (no duplicate sessions).
 */
export async function completeOnce(): Promise<void> {
  const run = async () => {
    await useTimerStore.persist.rehydrate();
    const s = useTimerStore.getState();
    if (s.status !== 'running' || s.endsAt === null || Date.now() < s.endsAt - 200) return;
    const done = s.complete();
    if (done) addInAppNotification(done);
  };
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    await navigator.locks.request('pact-timer-complete', run);
  } else {
    await run();
  }
}

function copyFor(done: Completion): { title: string; body: string } {
  if (done.phase === 'focus') {
    return {
      title: 'Focus session complete',
      body: done.intent ? `“${done.intent}” — nice work. Take a break.` : 'Nice work. Time for a break.',
    };
  }
  return { title: done.phase === 'long' ? 'Long break is over' : 'Break is over', body: 'Ready for the next focus session?' };
}

function addInAppNotification(done: Completion) {
  const { title, body } = copyFor(done);
  useNotificationStore.getState().add({ title, body, kind: 'timer', link: { section: 'timer' } });
}

/**
 * Global (always mounted) so the timer keeps running no matter which section you're on:
 * schedules completion + a background alarm, shows the countdown in the tab title, and
 * announces completions (toast + chime) in whichever pact tab you're looking at.
 */
export function TimerEngine() {
  const status = useTimerStore((s) => s.status);
  const endsAt = useTimerStore((s) => s.endsAt);
  const phase = useTimerStore((s) => s.phase);
  const lastCompleted = useTimerStore((s) => s.lastCompleted);
  const seen = useRef<string | null>(useTimerStore.getState().lastCompleted?.id ?? null);

  // 1) complete when time's up; keep a chrome.alarms alarm so a closed tab still notifies
  useEffect(() => {
    if (status !== 'running' || endsAt === null) return;
    const alarm = `${ALARM_PREFIX}${phase}`;
    void scheduleAlarm(alarm, endsAt);
    const fire = () => void completeOnce();
    const timer = window.setTimeout(fire, Math.max(0, endsAt - Date.now()) + 30);
    // Background tabs get throttled; re-check the moment we're visible again.
    const onVisible = () => document.visibilityState === 'visible' && Date.now() >= endsAt && fire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      void clearAlarm(alarm);
    };
  }, [status, endsAt, phase]);

  // 2) live countdown in the tab title while running
  useEffect(() => {
    const restore = () => {
      document.title = baseTitle(useNavStore.getState().section);
    };
    if (status !== 'running' || endsAt === null) {
      restore();
      return;
    }
    const update = () => {
      const secs = Math.ceil(Math.max(0, endsAt - Date.now()) / 1000);
      document.title = `${formatClock(secs)} · ${PHASE_LABEL[phase]} — pact`;
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => {
      window.clearInterval(id);
      restore();
    };
  }, [status, endsAt, phase]);

  // 3) announce a fresh completion in the tab the user can see (once per completion)
  useEffect(() => {
    if (!lastCompleted || lastCompleted.id === seen.current) return;
    seen.current = lastCompleted.id;
    const fresh = Date.now() - lastCompleted.at < 20_000;
    if (!fresh || document.visibilityState !== 'visible') return;

    const { title, body } = copyFor(lastCompleted);
    const task = lastCompleted.taskId ? useKanbanStore.getState().tasks.find((t) => t.id === lastCompleted.taskId) : undefined;
    if (lastCompleted.phase === 'focus' && task && task.columnId !== 'done') {
      notify.action(
        title,
        `Mark #${task.number} done`,
        () => {
          const col = useKanbanStore.getState().tasks.filter((t) => t.boardId === task.boardId && t.columnId === 'done').length;
          useKanbanStore.getState().moveTask(task.id, 'done', col);
          notify.success(`#${task.number} marked done`);
        },
        body,
      );
    } else {
      notify.success(title, body);
    }
    if (useSettingsStore.getState().sounds) playChime(lastCompleted.phase === 'focus' ? 'up' : 'down');
  }, [lastCompleted]);

  return null;
}
