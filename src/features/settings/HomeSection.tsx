import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';
import { useHomeLayoutStore } from '@/features/home/layout';
import { LayoutRow } from '@/features/settings/HomePresetPicker';
import { ClockRow, PageRow, WidgetsRow } from '@/features/settings/HomeRows';
import { notify } from '@/lib/toast';
import { SettingsSection } from './ui';

export function HomeSection() {
  const resetLayout = useHomeLayoutStore((s) => s.resetLayout);
  return (
    <SettingsSection
      id="home"
      icon={Sparkles}
      title="Home"
      description="What you see on every new tab."
      action={
        <Button
          variant="ghost"
          size="xs"
          title="Back to the Classic layout. Your shortcuts and notes aren’t touched."
          onClick={() => {
            resetLayout();
            notify.success('Home layout reset');
          }}
        >
          Reset
        </Button>
      }
    >
      <LayoutRow />
      <ClockRow />
      <PageRow />
      <WidgetsRow />
    </SettingsSection>
  );
}
