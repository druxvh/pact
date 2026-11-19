import { MotionConfig } from 'motion/react';
import { CaptureSheet } from '@/features/capture/CaptureSheet';
import { hasStoredAccount } from '@/features/capture/store';
import { useSettingsStore } from '@/store/useSettingsStore';

/**
 * The toolbar button / shortcut opens this. It writes into the same stores as the new tab (extension pages share
 * localStorage) and deliberately never starts a Supabase session of its own — an open pact tab uploads the result.
 */
export function CapturePopup() {
  const motionPref = useSettingsStore((s) => s.motion);
  return (
    <MotionConfig reducedMotion={motionPref === 'system' ? 'user' : motionPref === 'reduced' ? 'always' : 'never'}>
      <main className="bg-background text-foreground">
        <CaptureSheet
          variant="popup"
          account={hasStoredAccount()}
          title={<h1 className="truncate text-sm font-semibold tracking-tight">Quick capture</h1>}
          onDone={() => window.close()}
        />
      </main>
    </MotionConfig>
  );
}
