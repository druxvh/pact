import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type CommandDraft,
  type CustomCommand,
  customBangsFrom,
  type DraftResult,
  draftOf,
  duplicateDraft,
  type ImportReport,
  mergeImported,
  migrateCommands,
  validateDraft,
} from '@/features/commands/model';
import { uid } from '@/lib/format';
import { setCustomBangs } from '@/lib/omnibox/bangs';
import { useOmniStore } from '@/lib/omnibox/store';
import { syncAcrossTabs } from '@/lib/persist';

export const COMMANDS_KEY = 'pact-commands';

type CommandsState = {
  items: CustomCommand[];
  /** Validate and add. The result says what is wrong per field, or carries the new command. */
  add: (draft: CommandDraft) => DraftResult;
  update: (id: string, draft: CommandDraft) => DraftResult;
  remove: (id: string) => CustomCommand | undefined;
  /** Put a removed command back where it was (Undo). */
  restore: (item: CustomCommand, index?: number) => void;
  duplicate: (id: string) => DraftResult;
  importItems: (incoming: readonly CustomCommand[], invalid?: number) => ImportReport;
  clear: () => void;
};

const nowIso = () => new Date().toISOString();

/**
 * Quicklinks, snippets and aliases — local to this device, for guests too. Stored as one list (`items`); every load runs
 * through `migrateCommands`, so a hand-edited or imported value can never put a bad address or a clashing alias in play.
 */
export const useCommandsStore = create<CommandsState>()(
  persist(
    (set, get) => ({
      items: [],

      add: (draft) => {
        const r = validateDraft(draft, get().items, { now: nowIso(), makeId: () => uid('cmd') });
        if (r.ok) set((s) => ({ items: [...s.items, r.item] }));
        return r;
      },

      update: (id, draft) => {
        const prev = get().items.find((c) => c.id === id);
        if (!prev) return { ok: false, errors: { form: 'That command no longer exists.' } };
        const r = validateDraft(draft, get().items, { now: nowIso(), id, createdAt: prev.createdAt });
        if (r.ok) set((s) => ({ items: s.items.map((c) => (c.id === id ? r.item : c)) }));
        return r;
      },

      remove: (id) => {
        const gone = get().items.find((c) => c.id === id);
        if (!gone) return undefined;
        set((s) => ({ items: s.items.filter((c) => c.id !== id) }));
        // what you picked in the omnibox is remembered by key: forget the ghost of a deleted command
        const key = gone.kind === 'quicklink' ? `ql:${id}` : gone.kind === 'snippet' ? `sn:${id}` : null;
        if (key) useOmniStore.getState().forget(key);
        return gone;
      },

      restore: (item, index) =>
        set((s) => {
          if (s.items.some((c) => c.id === item.id)) return s;
          const next = [...s.items];
          next.splice(Math.min(index ?? next.length, next.length), 0, item);
          return { items: migrateCommands({ items: next }, 1).items };
        }),

      duplicate: (id) => {
        const src = get().items.find((c) => c.id === id);
        if (!src) return { ok: false, errors: { form: 'That command no longer exists.' } };
        return get().add(duplicateDraft(src, get().items));
      },

      importItems: (incoming, invalid = 0) => {
        const { items, report } = mergeImported(get().items, incoming, invalid);
        if (report.added) set({ items });
        return report;
      },

      clear: () => set({ items: [] }),
    }),
    {
      name: COMMANDS_KEY,
      version: 1,
      partialize: (s) => ({ items: s.items }),
      migrate: (persisted, version) => migrateCommands(persisted, version),
      // The current version is checked on every load too (not only when it changes): the file is plain JSON in localStorage.
      merge: (persisted, current) => (persisted ? { ...current, ...migrateCommands(persisted, 1) } : current),
    },
  ),
);

syncAcrossTabs(COMMANDS_KEY, useCommandsStore);

// The quicklinks that can be searched from a chip join the omnibox's bang table (and follow edits, and other tabs' edits).
let bangSource: readonly CustomCommand[] | undefined;
const syncBangs = (items: readonly CustomCommand[]) => {
  if (items === bangSource) return;
  bangSource = items;
  setCustomBangs(customBangsFrom(items));
};
syncBangs(useCommandsStore.getState().items);
useCommandsStore.subscribe((s) => syncBangs(s.items));

/** Fill a form from a stored command. */
export const draftFor = (id: string): CommandDraft | null => {
  const c = useCommandsStore.getState().items.find((x) => x.id === id);
  return c ? draftOf(c) : null;
};
