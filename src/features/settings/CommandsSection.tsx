import { Command } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui';
import { CommandsManager } from '@/features/commands/CommandsManager';
import { useCommandsStore } from '@/features/commands/store';
import { pluralize } from '@/lib/format';
import { countCommands } from './commandCounts';
import { SettingsRow, SettingsSection } from './ui';

/** Settings → Commands: a one-line summary; the manager itself opens in a dialog. */
export function CommandsSection() {
  const items = useCommandsStore((s) => s.items);
  const c = useMemo(() => countCommands(items), [items]);
  const [open, setOpen] = useState(false);
  const summary =
    items.length === 0
      ? 'None yet — add quicklinks, snippets and aliases for the search box.'
      : `${pluralize(c.quicklink, 'quicklink')} · ${pluralize(c.snippet, 'snippet')} · ${pluralize(c.alias, 'alias', 'aliases')}`;

  return (
    <SettingsSection id="commands" icon={Command} title="Commands" description="Your own shortcuts for the search box and command palette.">
      <SettingsRow label="Custom commands" description={summary}>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Manage…
        </Button>
      </SettingsRow>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Custom commands</DialogTitle>
            <DialogDescription>Quicklinks, snippets and aliases — available from the Home search box and ⌘K.</DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[min(34rem,calc(100dvh-10rem))] overflow-y-auto">
            <CommandsManager />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
