import {
  BellOff,
  CircleCheck,
  Clock3,
  Copy,
  ExternalLink,
  FilePlus2,
  FileText,
  Keyboard,
  ListPlus,
  ListTodo,
  Lock,
  LogIn,
  MessageCircle,
  Moon,
  Pause,
  Play,
  Sparkles,
  SunMoon,
  Timer,
  Users,
} from 'lucide-react';
import { SECTION_BY_ID, SECTIONS } from '@/app/routes';
import { useChatStore } from '@/features/chat/store';
import { COLUMNS, useKanbanStore } from '@/features/kanban/store';
import { excerpt, useNotesStore } from '@/features/notes/store';
import { useTimerStore } from '@/features/timer/store';
import { TOOLS } from '@/features/tools/registry';
import { openUrl, pactUrl } from '@/lib/ext';
import { computeAnswer, describeMinutes, type Intent } from '@/lib/omnibox/answers';
import { scoreFields } from '@/lib/omnibox/engine';
import { type CoreDeps, copyKeepingFocus, coreProviders, linkActions, submitText } from '@/lib/omnibox/providers';
import type { OmniAction, OmniResult, Provider, Surface } from '@/lib/omnibox/types';
import { notify } from '@/lib/toast';
import { hostnameOf } from '@/lib/url';
import { type Section, toHash, useNavStore } from '@/store/useNavStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useThemeStore } from '@/store/useThemeStore';
import { useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';

/**
 * Where the omnibox gets its results. `@/lib/omnibox` holds the engine and the answers that need no app data;
 * everything that reads pact's own state (pages, notes, tasks, chats, shortcuts, timer…) is wired up here, so the ⌘K
 * palette and the Home search box offer exactly the same things.
 */

export type SiteLink = { id: string; title: string; url: string };

export type SourceOptions = {
  surface: Surface;
  signedIn: boolean;
  /** The sites on Home (pinned shortcuts + most visited). */
  links: readonly SiteLink[];
  /** Past searches, newest first. */
  recent: readonly string[];
  removeRecent: (query: string) => void;
  recordSearch: (query: string) => void;
};

const openSignIn = () => useUiStore.getState().setSignInOpen(true);
const go = (section: Section, sub?: string | null) => useNavStore.getState().go(section, sub);

const goAction = (section: Section, sub?: string | null, label?: string): OmniAction => ({
  id: 'open',
  label: label ?? `Go to ${SECTION_BY_ID[section].label}`,
  icon: SECTION_BY_ID[section].icon,
  run: () => go(section, sub),
});

const newTabAction = (section: Section, sub?: string | null): OmniAction => ({
  id: 'open-new-tab',
  label: 'Open in new tab',
  icon: ExternalLink,
  hotkey: 'mod+enter',
  run: () => openUrl(pactUrl(toHash(section, sub)), { newTab: true }),
});

const signInAction = (label = 'Sign in to unlock'): OmniAction => ({ id: 'sign-in', label, icon: LogIn, record: false, run: openSignIn });

const signInSuggestion = (): OmniResult => ({
  id: 'try:sign-in',
  group: 'suggestions',
  title: 'Sign in to unlock Notes, Tasks, Focus and more',
  icon: Lock,
  score: 1,
  locked: true,
  primary: signInAction('Sign in'),
  frecencyKey: null,
});

/* ───────────────────────────── pages ───────────────────────────── */

function pagesProvider(o: SourceOptions): Provider {
  return (q, ctx) => {
    // On Home the box is mostly for searching: with nothing typed it shows suggestions, plus any page you pinned.
    const homeEmpty = !q && o.surface === 'home';
    // A guest's empty palette gets one invitation instead of seven locked rows.
    if (!q && !o.signedIn) return o.surface === 'palette' ? [signInSuggestion()] : [];
    const current = useNavStore.getState().section;
    const out: OmniResult[] = [];
    for (const s of SECTIONS) {
      if (s.id === current) continue;
      if (homeEmpty && !ctx.pinned.includes(`page:${s.id}`)) continue;
      const locked = !o.signedIn && s.id !== 'home';
      const { score, matches } = scoreFields(q, s.label, [`go to open jump ${s.label}`, s.description]);
      if (score <= 0) continue;
      if (locked) {
        out.push({
          id: `lock:${s.id}`,
          group: 'pages',
          title: s.label,
          subtitle: 'Sign in to unlock',
          icon: Lock,
          score: score * 0.8,
          matches,
          locked: true,
          primary: signInAction(`Sign in to use ${s.label}`),
          frecencyKey: null,
        });
        continue;
      }
      out.push({
        id: `page:${s.id}`,
        group: 'pages',
        title: s.label,
        subtitle: s.description,
        keywords: `go to open jump ${s.description}`,
        icon: s.icon,
        score,
        matches,
        kbd: ['G', s.hotkey.toUpperCase()],
        primary: goAction(s.id),
        actions: [newTabAction(s.id)],
        completion: { text: s.label },
      });
    }
    return out;
  };
}

/* ───────────────────────────── actions ───────────────────────────── */

type StaticAction = {
  id: string;
  title: string;
  keywords?: string;
  icon: OmniResult['icon'];
  kbd?: string[];
  account?: boolean;
  run: () => void;
  label?: string;
};

function staticActions(): StaticAction[] {
  const timer = useTimerStore.getState();
  const running = timer.status === 'running';
  return [
    {
      id: 'new-note',
      title: 'Create a new note',
      keywords: 'write add',
      icon: FilePlus2,
      account: true,
      run: () => {
        useNotesStore.getState().addNote();
        go('notes');
      },
    },
    {
      id: 'new-task',
      title: 'Create a new task',
      keywords: 'todo kanban add',
      icon: ListPlus,
      account: true,
      run: () => {
        useUiStore.getState().setPendingNewTask(true);
        go('kanban');
      },
    },
    {
      id: 'timer',
      title: running ? 'Pause the timer' : 'Start the focus timer',
      keywords: 'pomodoro focus start pause stop',
      icon: running ? Pause : Play,
      account: true,
      run: () => {
        const t = useTimerStore.getState();
        if (t.status === 'running') t.pause();
        else t.start();
      },
    },
    { id: 'theme', title: 'Toggle light / dark theme', keywords: 'appearance mode', icon: SunMoon, run: () => useThemeStore.getState().toggle() },
    { id: 'system-theme', title: 'Use system theme', keywords: 'appearance auto', icon: Moon, run: () => useThemeStore.getState().setMode('system') },
    {
      id: 'shortcuts',
      title: 'Show keyboard shortcuts',
      keywords: 'keys help',
      icon: Keyboard,
      kbd: ['?'],
      run: () => useUiStore.getState().setShortcutsOpen(true),
    },
    {
      id: 'read',
      title: 'Mark all notifications as read',
      keywords: 'inbox clear',
      icon: BellOff,
      account: true,
      run: () => useNotificationStore.getState().markAllRead(),
    },
  ];
}

function actionsProvider(o: SourceOptions): Provider {
  return (q, ctx) => {
    const homeEmpty = !q && o.surface === 'home';
    const out: OmniResult[] = [];
    for (const a of staticActions()) {
      if (a.account && !o.signedIn) continue;
      if (homeEmpty && !ctx.pinned.includes(`action:${a.id}`)) continue;
      const { score, matches } = scoreFields(q, a.title, [a.keywords]);
      if (score <= 0) continue;
      out.push({
        id: `action:${a.id}`,
        group: 'actions',
        title: a.title,
        keywords: a.keywords,
        icon: a.icon,
        score,
        matches,
        kbd: a.kbd,
        primary: { id: 'run', label: a.title, icon: a.icon, run: a.run },
        frecencyKey: `action:${a.id}`,
      });
    }
    if (!o.signedIn && !homeEmpty) {
      const { score, matches } = scoreFields(q, 'Sign in', ['account log in login create account sync']);
      if (score > 0) {
        out.push({
          id: 'action:sign-in',
          group: 'actions',
          title: 'Sign in',
          subtitle: 'Unlock Notes, Tasks, Focus, Chat and more',
          icon: LogIn,
          score,
          matches,
          primary: signInAction('Sign in'),
          frecencyKey: null,
        });
      }
    }
    return out;
  };
}

/* ───────────────────────────── tools, notes, tasks, chats ───────────────────────────── */

function toolsProvider(o: SourceOptions): Provider {
  return (q, ctx) => {
    if (!o.signedIn) return [];
    const out: OmniResult[] = [];
    for (const t of TOOLS) {
      if (!q && !ctx.pinned.includes(`tool:${t.id}`)) continue; // only pinned tools are worth showing with nothing typed
      const { score, matches } = scoreFields(q, t.title, [t.keywords, t.description]);
      if (score <= 0) continue;
      out.push({
        id: `tool:${t.id}`,
        group: 'tools',
        title: t.title,
        subtitle: t.description,
        keywords: t.keywords,
        icon: t.icon,
        score,
        matches,
        primary: goAction('tools', t.id, `Open ${t.title}`),
        actions: [newTabAction('tools', t.id)],
        completion: { text: t.title },
      });
    }
    return out;
  };
}

function notesProvider(o: SourceOptions): Provider {
  return (q, ctx) => {
    if (!o.signedIn) return [];
    const { notes, notebooks } = useNotesStore.getState();
    // with nothing typed: the palette shows your three latest notes; both surfaces show pinned ones
    const latest = new Set(
      o.surface === 'palette'
        ? [...notes]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 3)
            .map((n) => n.id)
        : [],
    );
    const pool = q ? notes : notes.filter((n) => latest.has(n.id) || ctx.pinned.includes(`note:${n.id}`));
    const out: OmniResult[] = [];
    for (const n of pool) {
      const title = n.title.trim() || 'Untitled';
      const nb = notebooks.find((b) => b.id === n.notebookId);
      const { score, matches } = scoreFields(q, title, [n.body.slice(0, 400), nb?.name]);
      if (score <= 0) continue;
      out.push({
        id: `note:${n.id}`,
        group: 'notes',
        title,
        subtitle: `${nb?.name ?? 'Notebook'} · ${excerpt(n.body, 60) || 'No content'}`,
        icon: FileText,
        score,
        matches,
        primary: {
          id: 'open',
          label: 'Open note',
          icon: FileText,
          run: () => {
            const s = useNotesStore.getState();
            s.setActiveNotebook(n.notebookId);
            s.select(n.id);
            go('notes');
          },
        },
        actions: [
          { id: 'copy-title', label: 'Copy title', icon: Copy, hotkey: 'mod+c', record: false, run: () => void copyKeepingFocus(title, 'Title copied') },
        ],
        completion: { text: title },
      });
    }
    return out;
  };
}

function tasksProvider(o: SourceOptions): Provider {
  return (q, ctx) => {
    if (!o.signedIn) return [];
    const { tasks, boards } = useKanbanStore.getState();
    const open = new Set(
      o.surface === 'palette'
        ? tasks
            .filter((t) => t.columnId !== 'done')
            .slice(0, 3)
            .map((t) => t.id)
        : [],
    );
    const pool = q ? tasks : tasks.filter((t) => open.has(t.id) || ctx.pinned.includes(`task:${t.id}`));
    const out: OmniResult[] = [];
    for (const t of pool) {
      const { score, matches } = scoreFields(q, t.title, [`${t.description} #${t.number}`]);
      if (score <= 0) continue;
      const board = boards.find((b) => b.id === t.boardId);
      const col = COLUMNS.find((c) => c.id === t.columnId);
      const actions: OmniAction[] = [
        { id: 'copy-title', label: 'Copy title', icon: Copy, hotkey: 'mod+c', record: false, run: () => void copyKeepingFocus(t.title, 'Title copied') },
      ];
      if (t.columnId !== 'done') {
        actions.unshift({
          id: 'done',
          label: 'Mark as done',
          icon: CircleCheck,
          record: false,
          run: () => {
            useKanbanStore.getState().updateTask(t.id, { columnId: 'done' });
            notify.success('Task done', t.title);
          },
        });
      }
      out.push({
        id: `task:${t.id}`,
        group: 'tasks',
        title: t.title,
        subtitle: `#${t.number} · ${board?.name ?? 'Board'} · ${col?.title ?? ''}`,
        icon: t.columnId === 'done' ? CircleCheck : ListTodo,
        score,
        matches,
        primary: {
          id: 'open',
          label: 'Open task',
          icon: ListTodo,
          run: () => {
            useKanbanStore.getState().setActiveBoard(t.boardId);
            useUiStore.getState().setPendingTaskId(t.id);
            go('kanban');
          },
        },
        actions,
        completion: { text: t.title },
      });
    }
    return out;
  };
}

function chatsProvider(o: SourceOptions): Provider {
  return (q) => {
    if (!q || !o.signedIn) return [];
    const { conversations, messages } = useChatStore.getState();
    const { teammates } = useUserStore.getState();
    const out: OmniResult[] = [];
    for (const c of conversations) {
      const peer = c.kind === 'dm' ? teammates.find((t) => c.participantIds.includes(t.id)) : undefined;
      const title = c.kind === 'group' ? (c.name ?? 'Group') : (peer?.displayName ?? 'Conversation');
      const subtitle = c.kind === 'group' ? 'Group chat' : peer ? `@${peer.username}` : 'Direct message';
      let score = scoreFields(q, title, [subtitle]);
      if (score.score <= 0) {
        const recent = messages
          .filter((m) => m.conversationId === c.id && !m.deleted)
          .slice(-30)
          .map((m) => m.body)
          .join(' ');
        score = scoreFields(q, title, [recent]);
      }
      if (score.score <= 0) continue;
      out.push({
        id: `chat:${c.id}`,
        group: 'chats',
        title,
        subtitle,
        icon: c.kind === 'group' ? Users : MessageCircle,
        score: score.score,
        matches: score.matches,
        primary: {
          id: 'open',
          label: 'Open chat',
          icon: MessageCircle,
          run: () => {
            useChatStore.getState().setActive(c.id);
            go('chat', c.id);
          },
        },
        completion: { text: title },
      });
    }
    return out;
  };
}

/* ───────────────────────────── Home: shortcuts and history ───────────────────────────── */

function shortcutsProvider(o: SourceOptions): Provider {
  return (q, ctx) => {
    const out: OmniResult[] = [];
    const seen = new Set<string>();
    for (const l of o.links) {
      const host = hostnameOf(l.url);
      if (seen.has(host)) continue;
      seen.add(host);
      if (!q && !ctx.pinned.includes(`site:${host}`)) continue; // Home already shows them as tiles
      const { score, matches } = scoreFields(q, l.title, [host]);
      if (score <= 0) continue;
      const { primary, actions } = linkActions(l.url, 'Open');
      out.push({
        id: `site:${host}`,
        group: 'shortcuts',
        title: l.title,
        subtitle: host,
        icon: ExternalLink,
        site: { url: l.url, title: l.title },
        score,
        matches,
        primary: { ...primary, label: `Open ${l.title}` },
        actions,
        completion: { text: l.title },
      });
    }
    return out;
  };
}

function recentsProvider(o: SourceOptions): Provider {
  return (q) => {
    if (o.surface !== 'home') return [];
    const lower = q.toLowerCase();
    return o.recent
      .filter((r) => !q || (r.toLowerCase().startsWith(lower) && r.toLowerCase() !== lower))
      .slice(0, q ? 3 : 6)
      .map<OmniResult>((r, i) => ({
        id: `search:${r}`,
        group: 'recent',
        title: r,
        icon: Clock3,
        score: q ? 700 - i : 1,
        matches: q ? Array.from({ length: q.length }, (_, k) => k) : undefined,
        primary: { id: 'search', label: 'Search again', icon: ExternalLink, record: false, run: () => submitText(r, { recordSearch: o.recordSearch }) },
        actions: [{ id: 'copy-query', label: 'Copy search text', icon: Copy, hotkey: 'mod+c', record: false, run: () => void copyKeepingFocus(r, 'Copied') }],
        completion: { text: r },
        frecencyKey: null,
        removable: () => o.removeRecent(r),
      }));
  };
}

/** What to try when the box is empty on Home: your own shortcuts into the box, or a few examples for guests. */
function suggestionsProvider(o: SourceOptions): Provider {
  return (q) => {
    if (q || o.surface !== 'home') return [];
    const fill = (id: string, title: string, subtitle: string, text: string, icon: OmniResult['icon']): OmniResult => ({
      id: `try:${id}`,
      group: 'suggestions',
      title,
      subtitle,
      icon,
      score: 1,
      primary: { id: 'fill', label: 'Try it', icon, fill: text, run: () => {} },
      frecencyKey: null,
    });
    const out: OmniResult[] = [];
    if (o.signedIn) {
      out.push(fill('note', 'Capture a note', 'note: your text', 'note: ', FilePlus2));
      out.push(fill('task', 'Add a task', 'task: your text', 'task: ', ListPlus));
      out.push(fill('timer', 'Start a timer', 'timer 25', 'timer 25', Timer));
    } else {
      out.push(fill('calc', 'Do a quick sum', '12*(3+4)/2', '12*(3+4)/2', Sparkles));
      out.push(fill('unit', 'Convert units', '10 km in mi', '10 km in mi', Sparkles));
      out.push(fill('time', 'Check the time somewhere', 'time in tokyo', 'time in tokyo', Clock3));
      out.push(fill('bang', 'Search a site directly', '!yt lofi', '!yt lofi', Sparkles));
    }
    if (!o.signedIn) out.push(signInSuggestion());
    return out;
  };
}

/* ───────────────────────────── intents: timer, note, task ───────────────────────────── */

function createNote(text: string): string {
  const single = !text.includes('\n') && text.length <= 80;
  const first = text.split('\n')[0] ?? text;
  const title = single ? text : `${first.slice(0, 60).trimEnd()}${first.length > 60 ? '…' : ''}`;
  return useNotesStore.getState().addNote({ title, body: single ? '' : text });
}

function startTimer(minutes: number, label: string) {
  const t = useTimerStore.getState();
  t.setPhase('focus');
  t.setDurations({ focus: minutes });
  useTimerStore.getState().start();
  notify.success('Timer started', `${label} of focus. It keeps running on every page.`);
}

function intentResult(intent: Intent, o: SourceOptions): OmniResult {
  const signedIn = o.signedIn;
  if (intent.kind === 'timer') {
    const t = useTimerStore.getState();
    const replaces = t.status !== 'idle';
    const changesLength = t.durations.focus !== intent.minutes;
    const caption = !signedIn
      ? 'Sign in to use the focus timer'
      : replaces
        ? 'Replaces the timer that is running now'
        : changesLength
          ? `Also sets your focus length to ${describeMinutes(intent.minutes)}`
          : 'Counts down on every page, even with this tab closed';
    return {
      id: 'answer',
      group: 'answer',
      title: intent.label,
      subtitle: 'Focus timer',
      icon: Timer,
      score: 5000,
      locked: !signedIn,
      frecencyKey: null,
      answer: { kind: 'intent', expression: 'Focus timer', value: intent.label, copy: '', caption, cta: signedIn ? 'Start timer' : 'Sign in to use' },
      primary: signedIn
        ? { id: 'start', label: `Start ${intent.label} timer`, icon: Play, run: () => startTimer(intent.minutes, intent.label) }
        : signInAction('Sign in to use the timer'),
      actions: signedIn ? [goAction('timer', null, 'Open Focus')] : [],
    };
  }

  const isNote = intent.kind === 'note';
  const text = intent.text;
  const short = text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text;
  const create = (open: boolean) => () => {
    if (isNote) {
      createNote(text);
      if (open) go('notes');
      else notify.action('Note saved', 'Open', () => go('notes'), short);
    } else {
      const s = useKanbanStore.getState();
      s.addTask(s.activeBoardId, 'todo', text);
      if (open) go('kanban');
      else notify.action('Task added', 'Open', () => go('kanban'), short);
    }
  };
  const icon = isNote ? FilePlus2 : ListPlus;
  const noun = isNote ? 'note' : 'task';
  const where = isNote
    ? (useNotesStore.getState().notebooks.find((b) => b.id === useNotesStore.getState().activeNotebookId)?.name ?? 'Notes')
    : (useKanbanStore.getState().boards.find((b) => b.id === useKanbanStore.getState().activeBoardId)?.name ?? 'Board');
  return {
    id: `intent:${noun}`,
    group: intent.explicit ? 'top' : 'actions',
    title: `Create ${noun} “${short}”`,
    subtitle: signedIn ? `In ${where}${isNote ? '' : ' · To do'}` : `Sign in to use ${isNote ? 'Notes' : 'Tasks'}`,
    icon: signedIn ? icon : Lock,
    score: intent.explicit ? 1800 : 950,
    locked: !signedIn,
    frecencyKey: null,
    primary: signedIn ? { id: 'create', label: `Create ${noun}`, icon, run: create(false) } : signInAction(`Sign in to use ${isNote ? 'Notes' : 'Tasks'}`),
    actions: signedIn ? [{ id: 'create-open', label: `Create ${noun} and open`, icon, hotkey: 'mod+enter', run: create(true) }] : [],
  };
}

function intentsProvider(o: SourceOptions): Provider {
  return (q, ctx) => {
    const c = computeAnswer(q, { now: ctx.now, locale: ctx.locale });
    return c?.type === 'intent' ? [intentResult(c.intent, o)] : [];
  };
}

/* ───────────────────────────── assembly ───────────────────────────── */

export function coreDeps(o: Pick<SourceOptions, 'signedIn' | 'recordSearch'>): CoreDeps {
  return { recordSearch: o.recordSearch, openTool: o.signedIn ? (id) => go('tools', id) : undefined };
}

/** Everything the omnibox can show, in the order providers are consulted (the engine does the ranking). */
export function buildProviders(o: SourceOptions): Provider[] {
  return [
    ...coreProviders(coreDeps(o)),
    intentsProvider(o),
    pagesProvider(o),
    actionsProvider(o),
    toolsProvider(o),
    notesProvider(o),
    tasksProvider(o),
    chatsProvider(o),
    shortcutsProvider(o),
    recentsProvider(o),
    suggestionsProvider(o),
  ];
}
