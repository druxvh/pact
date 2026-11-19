import { Laptop, Moon, Palette, Sun } from 'lucide-react';
import { useRef } from 'react';
import { Button, Segmented, Switch } from '@/components/ui';
import { AccentRow } from '@/features/settings/AccentPicker';
import { FontRow } from '@/features/settings/FontPicker';
import { OmniEffectRow } from '@/features/settings/OmniEffectPicker';
import { RoundnessRow } from '@/features/settings/RoundnessPicker';
import { StyleRow } from '@/features/settings/StylePicker';
import { WallpaperRow } from '@/features/settings/WallpaperPicker';
import { IMAGE_ASSET_ID } from '@/lib/appearance/wallpaper';
import { deleteAsset } from '@/lib/assets';
import { notify } from '@/lib/toast';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { type MotionPreference, useSettingsStore } from '@/store/useSettingsStore';
import { type ThemeMode, useThemeStore } from '@/store/useThemeStore';
import { ScrollX, SettingsRow, SettingsSection } from './ui';

export function AppearanceSection() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const motionPref = useSettingsStore((s) => s.motion);
  const sounds = useSettingsStore((s) => s.sounds);
  const set = useSettingsStore((s) => s.set);
  // The theme change reveals as a circle from wherever the user last pressed.
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);

  return (
    <SettingsSection
      id="appearance"
      icon={Palette}
      title="Appearance"
      description="Make pact feel the way you like."
      action={
        <Button
          variant="ghost"
          size="xs"
          title="Back to the default style, accent, font, roundness, search bar effect and no wallpaper"
          onClick={async () => {
            await deleteAsset(IMAGE_ASSET_ID).catch(() => {});
            useAppearanceStore.getState().resetAppearance();
            notify.success('Appearance reset');
          }}
        >
          Reset
        </Button>
      }
    >
      <StyleRow />
      <SettingsRow label="Theme" description="System follows your OS and switches automatically.">
        <div onPointerDownCapture={(e) => (origin.current = { x: e.clientX, y: e.clientY })}>
          <Segmented<ThemeMode>
            aria-label="Theme"
            value={mode}
            onValueChange={(m) => setMode(m, origin.current)}
            options={[
              { value: 'light', label: 'Light', icon: <Sun /> },
              { value: 'dark', label: 'Dark', icon: <Moon /> },
              { value: 'system', label: 'System', icon: <Laptop /> },
            ]}
          />
        </div>
      </SettingsRow>
      <AccentRow />
      <RoundnessRow />
      <FontRow />
      <WallpaperRow />
      <OmniEffectRow />
      <SettingsRow label="Animations" description="“System” follows your OS’s reduce-motion setting.">
        <ScrollX>
          <Segmented<MotionPreference>
            aria-label="Animations"
            value={motionPref}
            onValueChange={(v) => set('motion', v)}
            options={[
              { value: 'system', label: 'System' },
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
            ]}
          />
        </ScrollX>
      </SettingsRow>
      <SettingsRow label="Sounds" description="A soft chime when a focus session or break ends." htmlFor="set-sounds">
        <Switch id="set-sounds" checked={sounds} onCheckedChange={(v) => set('sounds', v)} aria-label="Sounds" />
      </SettingsRow>
    </SettingsSection>
  );
}
