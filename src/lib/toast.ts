import { toast } from 'sonner';

/** Tiny wrapper so features share one toast vocabulary (and one place to tune it). */
export const notify = {
  success: (message: string, description?: string) => toast.success(message, { description }),
  error: (message: string, description?: string) => toast.error(message, { description }),
  info: (message: string, description?: string) => toast(message, { description }),
  /** A toast with a custom action button. */
  action: (message: string, label: string, onClick: () => void, description?: string) =>
    toast(message, { description, duration: 10000, action: { label, onClick } }),
  /** A toast with an Undo action — use instead of a blocking confirm() for reversible deletes. */
  undo: (message: string, onUndo: () => void, description?: string) =>
    toast(message, {
      description,
      duration: 6000,
      action: { label: 'Undo', onClick: onUndo },
    }),
};
