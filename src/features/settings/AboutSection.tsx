import { Info, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui';
import { SettingsRow, SettingsSection } from '@/features/settings/ui';
import { HelpRows } from '@/features/tour/HelpRows';
import { ArtCredits } from '@/features/ultramarine/ArtCredits';
import { appVersion } from '@/lib/ext';
import { useUiStore } from '@/store/useUiStore';

export function AboutSection() {
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const togglePalette = useUiStore((s) => s.togglePalette);
  return (
    <SettingsSection
      id="about"
      icon={Info}
      title="About"
      description="A new tab for notes, tasks, focus, tools and company."
      action={<span className="font-mono text-xs text-muted-foreground">pact {appVersion()}</span>}
    >
      <SettingsRow label="Keyboard" description="⌘K jumps anywhere, g then a letter switches pages, ? lists every shortcut.">
        <Button variant="outline" size="sm" onClick={togglePalette}>
          Command palette
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShortcutsOpen(true)}>
          <Keyboard /> Shortcuts
        </Button>
      </SettingsRow>
      <HelpRows />
      <SettingsRow label="Image credits" description={<ArtCredits />} className="items-start py-3" />
    </SettingsSection>
  );
}
