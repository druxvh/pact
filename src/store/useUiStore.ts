import { create } from 'zustand';

/** Ephemeral UI state shared across the shell (not persisted). */
type UiState = {
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setShortcutsOpen: (open: boolean) => void;
  signInOpen: boolean;
  setSignInOpen: (open: boolean) => void;
  /** The quick-capture sheet (press `C`). */
  captureOpen: boolean;
  setCaptureOpen: (open: boolean) => void;
  /** The camera studio (`!cam`, or "Open camera" in the palette). */
  cameraOpen: boolean;
  setCameraOpen: (open: boolean) => void;
  /** One-shot intents: the palette sets them, the target view consumes them on mount. */
  pendingTaskId: string | null;
  pendingNewTask: boolean;
  setPendingTaskId: (id: string | null) => void;
  setPendingNewTask: (v: boolean) => void;
  /** Room code handed from Chat's "Watch together" to the VibeParty view. */
  partyRoom: string | null;
  setPartyRoom: (code: string | null) => void;
};

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  shortcutsOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  signInOpen: false,
  setSignInOpen: (signInOpen) => set({ signInOpen }),
  captureOpen: false,
  setCaptureOpen: (captureOpen) => set({ captureOpen }),
  cameraOpen: false,
  setCameraOpen: (cameraOpen) => set({ cameraOpen }),
  pendingTaskId: null,
  pendingNewTask: false,
  setPendingTaskId: (pendingTaskId) => set({ pendingTaskId }),
  setPendingNewTask: (pendingNewTask) => set({ pendingNewTask }),
  partyRoom: null,
  setPartyRoom: (partyRoom) => set({ partyRoom }),
}));
