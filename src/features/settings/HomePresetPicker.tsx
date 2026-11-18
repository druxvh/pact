import { Segmented } from '@/components/ui';
import { PRESETS, type PresetId, presetOf, useHomeLayoutStore } from '@/features/home/layout';
import { ScrollX, SettingsRow } from './ui';

/** Settings → Home → Layout: five one-click themes. Tweaking anything afterwards makes it “Custom” (nothing selected). */
export function LayoutRow() {
  const layout = useHomeLayoutStore((s) => s.layout);
  const applyPreset = useHomeLayoutStore((s) => s.applyPreset);
  const current = presetOf(layout);
  const preset = PRESETS.find((p) => p.id === current);

  return (
    <SettingsRow label="Layout" description={preset ? preset.description : 'Customised — pick a layout to start over.'}>
      <ScrollX>
        <Segmented<PresetId>
          aria-label="Home layout"
          // `custom` matches no option, so no pill is lit — which is the truth.
          value={current as PresetId}
          onValueChange={applyPreset}
          options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
      </ScrollX>
    </SettingsRow>
  );
}
