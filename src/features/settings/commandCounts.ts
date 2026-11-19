/** How many custom commands the person has, per kind — for the summary row in Settings → Commands. */
import type { CommandKind } from '@/features/commands/model';

export type CommandCounts = Record<CommandKind, number>;

export function countCommands(items: ReadonlyArray<{ kind: CommandKind }>): CommandCounts {
  const out: CommandCounts = { quicklink: 0, snippet: 0, alias: 0 };
  for (const c of items) if (c.kind in out) out[c.kind]++;
  return out;
}
