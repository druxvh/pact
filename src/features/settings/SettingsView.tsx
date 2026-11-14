import {
  Download,
  Info,
  Keyboard,
  Laptop,
  Moon,
  Palette,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useRef, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Input,
  Label,
  PageHeader,
  Segmented,
  Switch,
  Textarea,
  confirm,
} from '@/components/ui';
import { useChatStore } from '@/features/chat/store';
import { useHomeStore } from '@/features/home/store';
import { useKanbanStore } from '@/features/kanban/store';
import { useNotesStore } from '@/features/notes/store';
import { useTimerStore } from '@/features/timer/store';
import { downloadText } from '@/lib/download';
import { appVersion } from '@/lib/ext';
import { fadeUp, stagger } from '@/lib/motion';
import { notify } from '@/lib/toast';
import { exportBackup, importBackup, loadSampleWorkspace, parseBackup, resetAllData } from '@/store/demoServer';
import { type ClockFormat, type MotionPreference, useSettingsStore } from '@/store/useSettingsStore';
import { type ThemeMode, useThemeStore } from '@/store/useThemeStore';
import { useUiStore } from '@/store/useUiStore';
import { normalizeUsername, useUserStore, validateUsername } from '@/store/useUserStore';

/** One labelled control: text on the left, the control on the right (stacks on narrow screens). */
function Row({ label, description, htmlFor, children }: { label: string; description?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: typeof Palette; title: string; description?: string; children: ReactNode }) {
  return (
    <motion.div variants={fadeUp}>
      <Card className="gap-4 p-5">
        <header className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text">
            <Icon className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
          </div>
        </header>
        <div className="divide-y divide-border">{children}</div>
      </Card>
    </motion.div>
  );
}

// ── profile ──────────────────────────────────────────────────────────────────

function ProfileSection() {
  const me = useUserStore((s) => s.currentUser);
  const updateProfile = useUserStore((s) => s.updateProfile);
  const [form, setForm] = useState({
    displayName: me.displayName === 'You' ? '' : me.displayName,
    username: me.username,
    designation: me.designation ?? '',
    email: me.email ?? '',
    bio: me.bio ?? '',
  });

  const baseline = {
    displayName: me.displayName === 'You' ? '' : me.displayName,
    username: me.username,
    designation: me.designation ?? '',
    email: me.email ?? '',
    bio: me.bio ?? '',
  };
  const dirty = (Object.keys(form) as Array<keyof typeof form>).some((k) => form[k] !== baseline[k]);
  const usernameError = form.username !== baseline.username ? validateUsername(form.username) : null;
  const emailError = form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim()) ? 'That doesn’t look like an email address' : null;
  const canSave = dirty && !usernameError && !emailError;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const shownName = form.displayName.trim() || 'You';

  const save = () => {
    const saved = {
      displayName: shownName,
      username: normalizeUsername(form.username) || 'you',
      designation: form.designation.trim(),
      email: form.email.trim(),
      bio: form.bio.trim(),
    };
    updateProfile(saved);
    // Show exactly what was stored (e.g. "@Zoe_O" → "zoe_o"), otherwise the form would look unsaved forever.
    setForm({ ...saved, displayName: saved.displayName === 'You' ? '' : saved.displayName });
    notify.success('Profile saved');
  };

  return (
    <Section icon={UserRound} title="Profile" description="Shown in chats and to friends. The username is how people find you.">
      <div className="space-y-4 py-0">
        <div className="flex items-center gap-3">
          <Avatar name={shownName} size="xl" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold tracking-tight">{shownName}</p>
            <p className="truncate text-[13px] text-muted-foreground">@{normalizeUsername(form.username) || 'you'}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="set-name">Display name</Label>
            <Input id="set-name" value={form.displayName} onChange={set('displayName')} maxLength={40} placeholder="Your name" autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="set-username">Username</Label>
            <Input id="set-username" value={form.username} onChange={set('username')} maxLength={21} placeholder="you" autoComplete="username" aria-invalid={usernameError ? true : undefined} aria-describedby="set-username-err" />
            <p id="set-username-err" className="mt-1 min-h-4 text-xs text-destructive-text" role="alert">
              {usernameError}
            </p>
          </div>
          <div>
            <Label htmlFor="set-role">Role</Label>
            <Input id="set-role" value={form.designation} onChange={set('designation')} maxLength={60} placeholder="Student, designer, engineer…" />
          </div>
          <div>
            <Label htmlFor="set-email">Email (optional)</Label>
            <Input id="set-email" type="email" value={form.email} onChange={set('email')} maxLength={120} placeholder="you@example.com" autoComplete="email" aria-invalid={emailError ? true : undefined} aria-describedby="set-email-err" />
            <p id="set-email-err" className="mt-1 min-h-4 text-xs text-destructive-text" role="alert">
              {emailError}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="set-bio">Bio</Label>
            <Textarea id="set-bio" value={form.bio} onChange={set('bio')} rows={2} maxLength={160} placeholder="A line about you" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => setForm(baseline)}>
              Discard
            </Button>
          )}
          <Button variant="primary" disabled={!canSave} onClick={save}>
            Save changes
          </Button>
        </div>
      </div>
    </Section>
  );
}

// ── appearance & home ────────────────────────────────────────────────────────

function AppearanceSection() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const motionPref = useSettingsStore((s) => s.motion);
  const sounds = useSettingsStore((s) => s.sounds);
  const set = useSettingsStore((s) => s.set);
  // The theme change reveals as a circle from wherever the user last pressed.
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);

  return (
    <Section icon={Palette} title="Appearance" description="Make pact feel the way you like.">
      <Row label="Theme" description="System follows your OS and switches automatically.">
        <div onPointerDownCapture={(e) => (origin.current = { x: e.clientX, y: e.clientY })}>
          <Segmented<ThemeMode>
            aria-label="Theme"
            value={mode}
            onValueChange={(m) => setMode(m, origin.current)}
            options={[
              { value: 'light', label: 'Light', icon: <Sun /> },
              { value: 'dark', label: 'Dark', icon: <Moon /> },
              { value: 'system', label: 'System', icon: <Laptop /> },
            ]}
          />
        </div>
      </Row>
      <Row label="Animations" description="“System” follows your OS’s reduce-motion setting.">
        <Segmented<MotionPreference>
          aria-label="Animations"
          value={motionPref}
          onValueChange={(v) => set('motion', v)}
          options={[
            { value: 'system', label: 'System' },
            { value: 'full', label: 'Full' },
            { value: 'reduced', label: 'Reduced' },
          ]}
        />
      </Row>
      <Row label="Sounds" description="A soft chime when a focus session or break ends." htmlFor="set-sounds">
        <Switch id="set-sounds" checked={sounds} onCheckedChange={(v) => set('sounds', v)} aria-label="Sounds" />
      </Row>
    </Section>
  );
}

function HomeSection() {
  const { clock, showGreeting, showTopSites, set } = useSettingsStore();
  const hidden = useHomeStore((s) => s.hiddenHosts.length);
  const resetHidden = useHomeStore((s) => s.resetHidden);

  return (
    <Section icon={Sparkles} title="Home" description="What you see on every new tab.">
      <Row label="Clock" description="12-hour, 24-hour, or whatever your locale prefers.">
        <Segmented<ClockFormat>
          aria-label="Clock format"
          value={clock}
          onValueChange={(v) => set('clock', v)}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: '12h', label: '12h' },
            { value: '24h', label: '24h' },
          ]}
        />
      </Row>
      <Row label="Greeting" description="“Good evening, Sam” above the search box." htmlFor="set-greeting">
        <Switch id="set-greeting" checked={showGreeting} onCheckedChange={(v) => set('showGreeting', v)} aria-label="Greeting" />
      </Row>
      <Row label="Most visited sites" description="Tiles from your browser’s history. pact asks the browser; nothing leaves your device." htmlFor="set-topsites">
        <Switch id="set-topsites" checked={showTopSites} onCheckedChange={(v) => set('showTopSites', v)} aria-label="Most visited sites" />
      </Row>
      <Row label="Hidden sites" description={hidden ? `${hidden} site${hidden === 1 ? '' : 's'} removed from Home.` : 'You haven’t removed any sites from Home.'}>
        <Button
          variant="outline"
          disabled={hidden === 0}
          onClick={() => {
            resetHidden();
            notify.success('Hidden sites restored');
          }}
        >
          Show them again
        </Button>
      </Row>
    </Section>
  );
}

// ── data ─────────────────────────────────────────────────────────────────────

function DataSection() {
  const notes = useNotesStore((s) => s.notes.length);
  const tasks = useKanbanStore((s) => s.tasks.length);
  const sessions = useTimerStore((s) => s.sessions.length);
  const messages = useChatStore((s) => s.messages.length);
  const friends = useUserStore((s) => s.friendIds.length);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const stats = [
    ['Notes', notes],
    ['Tasks', tasks],
    ['Focus sessions', sessions],
    ['Messages', messages],
    ['Friends', friends],
  ] as const;

  const exportData = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`pact-backup-${stamp}.json`, JSON.stringify(exportBackup(), null, 2));
    notify.success('Backup downloaded', 'Chat attachments (images and video) aren’t included.');
  };

  const importFile = async (file: File) => {
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      notify.error('Couldn’t import that file', parsed.error);
      return;
    }
    const when = Number.isNaN(Date.parse(parsed.backup.exportedAt)) ? '' : ` from ${new Date(parsed.backup.exportedAt).toLocaleString()}`;
    const ok = await confirm({
      title: 'Replace your data with this backup?',
      description: `This overwrites the notes, boards, chats and settings on this device with the backup${when}. It can’t be undone — export a backup of your current data first if you might want it.`,
      confirmLabel: 'Replace my data',
      destructive: true,
    });
    if (!ok) return;
    importBackup(parsed.backup);
    notify.success('Backup restored', 'Reloading…');
    window.setTimeout(() => location.reload(), 700);
  };

  const loadSample = async () => {
    const hasData = notes + tasks + messages + friends > 0;
    const ok = await confirm({
      title: 'Load the sample workspace?',
      description: hasData
        ? 'This replaces your current notes, boards, chats and friends on this device with example data. Export a backup first if you want to keep what you have.'
        : 'Fills pact with example notes, a board, chats and friends so you can explore everything.',
      confirmLabel: hasData ? 'Replace with samples' : 'Load samples',
      destructive: hasData,
    });
    if (!ok) return;
    loadSampleWorkspace();
    notify.success('Sample workspace loaded');
  };

  const reset = async () => {
    const ok = await confirm({
      title: 'Erase everything on this device?',
      description: 'Notes, boards, chats, attachments, timer history, settings and your profile will be deleted. This can’t be undone.',
      confirmLabel: 'Erase everything',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    await resetAllData();
    location.reload();
  };

  return (
    <Section icon={ShieldCheck} title="Your data" description="Stored on this device only — in your browser’s local storage. Nothing is uploaded and nothing syncs between devices.">
      <div className="pb-4">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-background/50 px-3 py-2.5">
              <dd className="text-xl font-semibold tabular tracking-tight">{value}</dd>
              <dt className="text-xs text-muted-foreground">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
      <Row label="Backup" description="Download everything as a file you can restore here — or on another computer — later.">
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportData}>
            <Download /> Export
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload /> Import
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Choose a pact backup file"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importFile(file);
            }}
          />
        </div>
      </Row>
      <Row label="Sample workspace" description="Example notes, a kanban board, chats and friends — handy for a tour.">
        <Button variant="outline" onClick={() => void loadSample()}>
          <Sparkles /> Load samples
        </Button>
      </Row>
      <Row label="Erase everything" description="Resets pact to a fresh install on this device.">
        <Button variant="danger" loading={busy} onClick={() => void reset()}>
          <Trash2 /> Erase all data
        </Button>
      </Row>
    </Section>
  );
}

function AboutSection() {
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const togglePalette = useUiStore((s) => s.togglePalette);
  return (
    <Section icon={Info} title="About" description="pact — a new tab for notes, tasks, focus, tools and company.">
      <Row label="Keyboard" description="⌘K jumps anywhere, g then a letter switches pages, ? lists every shortcut.">
        <div className="flex gap-2">
          <Button variant="outline" onClick={togglePalette}>
            Command palette
          </Button>
          <Button variant="outline" onClick={() => setShortcutsOpen(true)}>
            <Keyboard /> Shortcuts
          </Button>
        </div>
      </Row>
      <Row label="Version">
        <span className="font-mono text-xs text-muted-foreground">pact {appVersion()}</span>
      </Row>
    </Section>
  );
}

export function SettingsView() {
  return (
    <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="mx-auto w-full max-w-3xl space-y-4">
      <motion.div variants={fadeUp}>
        <PageHeader icon={Settings} title="Settings" description="Profile, appearance and your data" />
      </motion.div>
      <ProfileSection />
      <AppearanceSection />
      <HomeSection />
      <DataSection />
      <AboutSection />
    </motion.div>
  );
}
