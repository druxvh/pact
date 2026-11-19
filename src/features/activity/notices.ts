import { useActivityStore } from './hooks';
import type { ActivityMessage } from './types';

/** Bell entries for activity messages are keyed `activity:<personId>:<messageId>` (see the store's `notice`). */
const KEY = /^activity:[^:]+:([^:]+)$/;

/**
 * The activity message behind a bell entry (for its icon and cover), or undefined — not one of ours, or not loaded (yet). A hook, since
 * it follows the store; it takes the entry's `key` and returns the message object itself, so it never re-renders for nothing.
 */
export function useActivityMessage(key: string | undefined): ActivityMessage | undefined {
  const id = key ? KEY.exec(key)?.[1] : undefined;
  return useActivityStore((s) => (id ? s.messages.find((m) => m.id === id) : undefined));
}
