import { Download, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, confirm } from '@/components/ui';
import { useChatStore } from '@/features/chat/store';
import { useKanbanStore } from '@/features/kanban/store';
import { useNotesStore } from '@/features/notes/store';
import { SnapshotRows } from '@/features/settings/DataSafety';
import { useTimerStore } from '@/features/timer/store';
import { createSnapshot, exportBackupFile, startImportFromFile } from '@/lib/backup';
import { clearSnapshots } from '@/lib/backup/db';
import { pluralize } from '@/lib/format';
import { notify } from '@/lib/toast';
import { loadSampleWorkspace, resetAllData } from '@/store/demoServer';
import { useUserStore } from '@/store/useUserStore';
import { SettingsRow, SettingsSection } from './ui';

export function DataSection() {
  const notes = useNotesStore((s) => s.notes.length);
  const tasks = useKanbanStore((s) => s.tasks.length);
  const sessions = useTimerStore((s) => s.sessions.length);
  const messages = useChatStore((s) => s.messages.length);
  const friends = useUserStore((s) => s.friendIds.length);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const summary = [
    pluralize(notes, 'note'),
    pluralize(tasks, 'task'),
    pluralize(sessions, 'focus session'),
    pluralize(messages, 'message'),
    pluralize(friends, 'friend'),
  ].join(' · ');

  // Opens the preview dialog (mounted by SnapshotRows); nothing is applied until it is confirmed there.
  const importFile = (file: File) => void startImportFromFile(file);

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
    if (hasData) await createSnapshot({ kind: 'safety', label: 'Before loading the sample workspace' }).catch(() => null);
    loadSampleWorkspace();
    notify.success('Sample workspace loaded');
  };

  const reset = async () => {
    const ok = await confirm({
      title: 'Erase everything on this device?',
      description:
        'Notes, boards, chats, attachments, timer history, settings, your profile and every saved snapshot will be deleted from this device. Notes in your account aren’t deleted — they sync back the next time you’re signed in. This can’t be undone.',
      confirmLabel: 'Erase everything',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    await resetAllData();
    await clearSnapshots().catch(() => {});
    location.reload();
  };

  return (
    <SettingsSection id="data" icon={ShieldCheck} title="Your data" description="Kept on this device. Notes also sync to your account when you’re signed in.">
      <SettingsRow label="Backup" description={summary}>
        <Button variant="outline" size="sm" onClick={() => void exportBackupFile()}>
          <Download /> Export
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
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
            if (file) importFile(file);
          }}
        />
      </SettingsRow>
      <SnapshotRows />
      <SettingsRow label="Sample workspace" description="Example notes, a board, chats and friends — handy for a tour.">
        <Button variant="outline" size="sm" onClick={() => void loadSample()}>
          <Sparkles /> Load samples
        </Button>
      </SettingsRow>
      <SettingsRow label="Erase everything" description="Resets pact to a fresh install on this device. Notes in your account sync back.">
        <Button variant="danger" size="sm" loading={busy} onClick={() => void reset()}>
          <Trash2 /> Erase all data
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}
