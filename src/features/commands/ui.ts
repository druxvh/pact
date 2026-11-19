import { create } from 'zustand';
import type { CommandDraft, CommandKind } from '@/features/commands/model';

/** Which command dialog is open (ephemeral). The omnibox's "Create Quicklink…" actions and a result's "Edit" set it; `CommandDialogs` shows it. */
export type CommandsDialog = { type: 'create'; kind: CommandKind; draft?: Partial<CommandDraft> } | { type: 'edit'; id: string } | { type: 'manage' } | null;

type UiState = { dialog: CommandsDialog; open: (d: Exclude<CommandsDialog, null>) => void; close: () => void };

export const useCommandsUi = create<UiState>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

export const openCreateCommand = (kind: CommandKind, draft?: Partial<CommandDraft>) => useCommandsUi.getState().open({ type: 'create', kind, draft });
export const openEditCommand = (id: string) => useCommandsUi.getState().open({ type: 'edit', id });
export const openManageCommands = () => useCommandsUi.getState().open({ type: 'manage' });
