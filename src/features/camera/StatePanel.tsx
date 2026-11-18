/** What the stage shows instead of a picture: the first-run explainer, "starting…", and every way the camera can fail. */
import { Camera, CameraOff, Copy, Lock, MonitorX, PlugZap, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { Button, Spinner } from '@/components/ui';
import { CAMERA_SETTINGS_URL, type CameraError, ERROR_COPY, needsSettingsHelp, siteSettingsUrl } from '@/features/camera/errors';
import { copyText } from '@/lib/clipboard';
import { isExtension } from '@/lib/ext';

const iconFor = (kind: CameraError['kind']): ReactNode => {
  switch (kind) {
    case 'no-camera':
      return <CameraOff />;
    case 'busy':
      return <PlugZap />;
    case 'unsupported':
      return <MonitorX />;
    case 'ended':
      return <RefreshCw />;
    case 'dismissed':
      return <Camera />;
    case 'unknown':
      return <TriangleAlert />;
    default:
      return <Lock />;
  }
};

function Frame({ icon, title, children, actions }: { icon: ReactNode; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    // `m-auto` (not place-items-center): when the content is taller than the stage it scrolls from its top instead of being cut off.
    <div className="absolute inset-0 flex overflow-y-auto p-5">
      <div className="m-auto flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-lg bg-white/10 text-white [&_svg]:size-6">{icon}</div>
        <h3 className="text-base font-semibold tracking-tight text-white">{title}</h3>
        <div className="space-y-3 text-[13px] leading-relaxed text-white/70">{children}</div>
        {actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** First run: say what will happen before the browser's own prompt does. */
export function ExplainerPanel({ onAllow }: { onAllow: () => void }) {
  return (
    <Frame
      icon={<Camera />}
      title="Turn on your camera"
      actions={
        <Button variant="primary" size="lg" onClick={onAllow} autoFocus>
          <Camera /> Allow camera
        </Button>
      }
    >
      <p>Take photos and record short videos right from your new tab. Your browser will ask for permission next.</p>
      <ul className="space-y-1.5 text-left">
        <Point>Stays on this device. Nothing is ever uploaded.</Point>
        <Point>The camera is on only while this window is open.</Point>
        <Point>The microphone is asked for only when you record with sound.</Point>
      </ul>
    </Frame>
  );
}

const Point = ({ children }: { children: ReactNode }) => (
  <li className="flex items-start gap-2">
    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
    <span>{children}</span>
  </li>
);

export function StartingPanel() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex items-center gap-2.5 text-[13px] text-white/70">
        <Spinner className="size-5" /> Starting camera…
      </div>
    </div>
  );
}

const extensionId = (): string | null => {
  try {
    return isExtension ? ((browser as { runtime?: { id?: string } } | undefined)?.runtime?.id ?? null) : null;
  } catch {
    return null;
  }
};

/** A line of text to copy. A page can't open `chrome://` links, so the address is shown and copied instead. */
function CopyLine({ text, what }: { text: string; what: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-black/40 p-1 pl-2.5 text-left ring-1 ring-white/10">
      <code className="min-w-0 flex-1 select-all break-all font-mono text-[12px] leading-snug text-white/90">{text}</code>
      <Button variant="secondary" size="xs" onClick={() => void copyText(text, `${what} copied — paste it into the address bar`)} aria-label={`Copy ${what}`}>
        <Copy /> Copy
      </Button>
    </div>
  );
}

export function ErrorPanel({ error, onRetry }: { error: CameraError; onRetry: () => void }) {
  const copy = ERROR_COPY[error.kind];
  const site = siteSettingsUrl(extensionId());
  return (
    <Frame
      icon={iconFor(error.kind)}
      title={copy.title}
      actions={
        copy.action ? (
          <Button variant="primary" size="lg" onClick={onRetry} autoFocus>
            {copy.action}
          </Button>
        ) : null
      }
    >
      <p>{copy.body}</p>
      {needsSettingsHelp(error.kind) && (
        <div className="space-y-2 text-left">
          <p className="text-white/85">
            Chrome doesn’t let a page open its settings, so copy this address and paste it into a new tab.{' '}
            {site ? (
              <>
                Set <b className="font-medium text-white">Camera</b> to <b className="font-medium text-white">Allow</b>.
              </>
            ) : (
              <>
                Find pact under <b className="font-medium text-white">Not allowed to use your camera</b> and set{' '}
                <b className="font-medium text-white">Camera</b> to <b className="font-medium text-white">Allow</b>.
              </>
            )}
          </p>
          <CopyLine text={site ?? CAMERA_SETTINGS_URL} what="Address" />
          {site && (
            <p className="text-white/60">
              That opens pact’s own settings. The full list is at <code className="select-all font-mono text-[12px] text-white/80">{CAMERA_SETTINGS_URL}</code>.
            </p>
          )}
        </div>
      )}
      {error.kind === 'denied-system' && (
        <p className="text-white/60">On a Mac: System Settings → Privacy &amp; Security → Camera. On Windows: Settings → Privacy &amp; security → Camera.</p>
      )}
      {error.kind === 'unknown' && error.message && <p className="break-words text-[12px] text-white/45">{error.message}</p>}
    </Frame>
  );
}
