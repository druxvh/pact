import { ExternalLink, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, buttonClass, Kbd } from '@/components/ui';
import { PRIVACY_PAGE } from '@/entrypoints/privacy/PrivacyLink';
import { defaultCaptureKeys, openShortcutSettings, readCaptureShortcut } from '@/features/capture/shortcut';
import { SettingsRow as Row } from '@/features/settings/ui';
import { useTourStore } from '@/features/tour/store';
import { isExtension } from '@/lib/ext';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';

/** Settings → About: replay the tour, see/change the quick-capture shortcut, read the privacy policy. */
export function HelpRows() {
  const signedIn = useAuthStore(selectSignedIn);
  const startTour = useTourStore((s) => s.start);
  // `[]` = bound to nothing, `null` = can't tell (not running as an extension) — show the suggested default then.
  const [bound, setBound] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    void readCaptureShortcut().then((keys) => alive && setBound(keys));
    return () => {
      alive = false;
    };
  }, []);
  const unbound = bound !== null && bound.length === 0;
  const keys = bound && bound.length > 0 ? bound : defaultCaptureKeys();

  return (
    <>
      <Row label="Welcome tour" description="A thirty-second look at where things are, the shortcuts and quick capture.">
        <Button variant="outline" size="sm" onClick={() => startTour(signedIn ? 'full' : 'guest')}>
          <Play /> Replay tour
        </Button>
      </Row>
      <Row
        label="Quick capture"
        description={
          unbound ? (
            <>
              Press <Kbd>C</Kbd> anywhere in pact, or use the pact button in your toolbar. No keyboard shortcut is set for it yet.
            </>
          ) : (
            <>
              Press <Kbd>C</Kbd> anywhere in pact. From any tab, use the pact button in your toolbar or{' '}
              <span className="inline-flex gap-0.5 align-middle">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
              .
            </>
          )
        }
      >
        {isExtension && (
          <Button variant="outline" size="sm" onClick={openShortcutSettings} title="Opens chrome://extensions/shortcuts">
            {unbound ? 'Set a shortcut' : 'Change shortcut'}
          </Button>
        )}
      </Row>
      <Row label="Privacy policy" description="What pact keeps on your device, what's stored when you sign in, and why each permission is needed.">
        <a href={PRIVACY_PAGE} target="_blank" rel="noopener noreferrer" className={buttonClass('outline', 'sm')}>
          <ExternalLink /> Read it
        </a>
      </Row>
    </>
  );
}
