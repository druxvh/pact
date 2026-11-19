import { useEffect, useState } from 'react';
import { create } from 'zustand';

/** Whether the note composer (a dialog mounted once in the app shell) is open — so any avatar menu, card or button can open it. */
export const useNoteComposer = create<{ open: boolean }>(() => ({ open: false }));
export const openNoteComposer = () => useNoteComposer.setState({ open: true });
export const closeNoteComposer = () => useNoteComposer.setState({ open: false });

/** Re-renders every `ms` (relative times, "23h left"). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
