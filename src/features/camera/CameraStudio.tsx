/**
 * The camera studio: a large dialog with a live preview, photo and video capture, filters, a self-timer and a filmstrip of recent captures.
 * Everything happens on this device; the stream runs only while the dialog is open.
 */
import { Aperture, Camera, Crop, FlipHorizontal2, Grid3x3, Mic, MicOff, SwitchCamera, Timer, Video, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { confirm, Dialog, DialogContent, DialogDescription, DialogTitle, IconButton, Segmented } from '@/components/ui';
import type { FramePlan } from '@/features/camera/capture';
import { nextTimer, timerLabel } from '@/features/camera/countdown';
import { Filmstrip, Lightbox } from '@/features/camera/Filmstrip';
import { type Adjust, FILTERS, NEUTRAL_ADJUST, opsFor, toCss } from '@/features/camera/filters';
import type { Capture } from '@/features/camera/gallery';
import { ASPECTS, type AspectId } from '@/features/camera/geometry';
import { AdjustPopover, SettingsPopover, ShortcutsPopover } from '@/features/camera/Panels';
import { FilterStrip, LiveRegion, Shutter, StageButton, useAnnouncer } from '@/features/camera/parts';
import { canRecord } from '@/features/camera/recorder';
import { Stage } from '@/features/camera/Stage';
import { effectiveMirror, useCameraStore } from '@/features/camera/store';
import { useCameraStream } from '@/features/camera/useCameraStream';
import { type CaptureMode, useCapture } from '@/features/camera/useCapture';
import { useGallery } from '@/features/camera/useGallery';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useSettingsStore } from '@/store/useSettingsStore';

const MODE_OPTIONS = [
  { value: 'photo', label: <span className="hidden sm:inline">Photo</span>, icon: <Camera />, ariaLabel: 'Photo mode' },
  { value: 'video', label: <span className="hidden sm:inline">Video</span>, icon: <Video />, ariaLabel: 'Video mode' },
] as const;

const nextAspect = (a: AspectId): AspectId => ASPECTS[(ASPECTS.findIndex((x) => x.id === a) + 1) % ASPECTS.length]?.id ?? 'original';

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function CameraStudio({ open, onOpenChange }: Props) {
  const prefs = useCameraStore();
  const setPref = prefs.set;
  const soundsEnabled = useSettingsStore((s) => s.sounds);
  const { message, announce } = useAnnouncer();
  const gallery = useGallery(open);

  const [adjust, setAdjust] = useState<Adjust>(NEUTRAL_ADJUST);
  const [viewing, setViewing] = useState<number | null>(null);

  const popupRef = useRef<HTMLDivElement>(null);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const confirming = useRef(false);
  const recordingRef = useRef(false);

  const camera = useCameraStream({
    enabled: open,
    deviceId: prefs.deviceId,
    resolution: prefs.resolution,
    keepAlive: () => recordingRef.current,
    allowedBefore: prefs.allowedBefore,
    onGranted: () => {
      if (!useCameraStore.getState().allowedBefore) setPref('allowedBefore', true);
    },
    onFallback: (what) => {
      if (what === 'device') {
        setPref('deviceId', null);
        notify.info('Using your default camera', 'The camera you picked isn’t available right now.');
      } else {
        setPref('resolution', 'auto');
        notify.info('That resolution isn’t available', 'Your camera can’t do it, so pact is using Auto.');
      }
    },
  });
  const live = camera.status.phase === 'live';
  const mirror = effectiveMirror(prefs.mirror, camera.info?.front ?? true);

  // The picture as the person has set it up — read at the moment of capture, and live while recording.
  const plan: FramePlan = { aspect: prefs.aspect, mirror, filter: prefs.filter, adjust };
  const planRef = useRef(plan);
  planRef.current = plan;
  const getPlan = useCallback(() => planRef.current, []);
  const filterCss = toCss(opsFor(prefs.filter, adjust));

  const cap = useCapture({
    videoRef: camera.videoRef,
    live,
    getPlan,
    timer: prefs.timer,
    mic: prefs.mic,
    sound: soundsEnabled && prefs.shutterSound,
    onMicUnavailable: () => setPref('mic', false),
    save: gallery.add,
    announce,
  });
  recordingRef.current = cap.recording !== null;
  const busy = cap.recording !== null || cap.counting !== null;

  // Closed → forget the per-visit state, so the next time opens ready for a photo with the picture as the camera sees it.
  const { setMode } = cap;
  useEffect(() => {
    if (open) return;
    setViewing(null);
    setAdjust(NEUTRAL_ADJUST);
    setMode('photo');
  }, [open, setMode]);

  // Once the picture is up, put focus on the shutter (unless someone is already using another control).
  useEffect(() => {
    if (!live) return;
    const a = document.activeElement;
    if (!a || a === document.body || a.getAttribute('role') === 'dialog') shutterRef.current?.focus({ preventScroll: true });
  }, [live]);

  // ── closing ────────────────────────────────────────────────────────────────

  const requestClose = async () => {
    if (confirming.current) return;
    if (viewing !== null) {
      setViewing(null);
      return;
    }
    if (cap.cancelCountdown()) return;
    if (cap.recording) {
      confirming.current = true;
      const ok = await confirm({
        title: 'Stop recording?',
        description: 'The video so far is saved to your recent captures, and the camera turns off.',
        confirmLabel: 'Stop and close',
        cancelLabel: 'Keep recording',
      });
      confirming.current = false;
      if (!ok) return;
      await cap.stopRecording();
    }
    onOpenChange(false);
  };

  // ── keyboard ───────────────────────────────────────────────────────────────

  const toggleMirror = () => setPref('mirror', !mirror);
  const handleKey = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKey.current = (e) => {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || viewing !== null) return;
    const target = e.target as HTMLElement | null;
    // Only keys that belong to this dialog: not a menu, confirm or other overlay that happens to be open.
    if (target && target !== document.body && !popupRef.current?.contains(target)) return;
    if (target?.closest('input, textarea, select, [role="slider"], [role="combobox"], [contenteditable="true"]')) return;

    if (e.key === ' ' || e.key === 'Enter') {
      // A focused button does its own thing; this is for when nothing in particular has focus.
      if (target?.closest('button, a[href], [role="tab"], [role="button"], summary')) return;
      e.preventDefault();
      cap.shutter();
      return;
    }
    const filterIndex = e.key >= '1' && e.key <= '8' ? Number(e.key) - 1 : -1;
    if (filterIndex >= 0) {
      const f = FILTERS[filterIndex];
      if (f) {
        e.preventDefault();
        setPref('filter', f.id);
        announce(`${f.label} filter`);
      }
      return;
    }
    if (e.repeat) return;
    switch (e.key.toLowerCase()) {
      case 'm':
        toggleMirror();
        announce(mirror ? 'Mirror off' : 'Mirror on');
        break;
      case 'g':
        setPref('grid', !prefs.grid);
        announce(prefs.grid ? 'Grid off' : 'Grid on');
        break;
      case 't': {
        if (busy) return;
        const next = nextTimer(prefs.timer);
        setPref('timer', next);
        announce(`Timer ${timerLabel(next)}`);
        break;
      }
      case 'a':
        if (cap.recording) return;
        setPref('aspect', nextAspect(prefs.aspect));
        break;
      case 'p':
        cap.setMode('photo');
        break;
      case 'v':
        cap.setMode('video');
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  /**
   * After a *mouse* click on a plain control (a filter, the mode, a toggle) focus goes back to the shutter, so Space and Enter stay
   * "take the picture" instead of re-pressing whatever was just clicked. Keyboard users are untouched: Space on a focused button
   * still presses that button, which is what they expect. Menus and popovers keep their own focus.
   */
  const returnFocusToShutter = useRef<(e: MouseEvent) => void>(() => {});
  returnFocusToShutter.current = (e) => {
    if (e.detail === 0 || !(e.target instanceof Element) || !popupRef.current?.contains(e.target)) return; // keyboard, or not ours
    const control = e.target.closest('button, [role="tab"]');
    if (!control || control === shutterRef.current) return;
    if (control.hasAttribute('aria-haspopup') || control.hasAttribute('aria-expanded') || control.closest('[role="combobox"]')) return;
    shutterRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => handleKey.current(e);
    const onClick = (e: MouseEvent) => returnFocusToShutter.current(e);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [open]);

  // ── gallery actions ────────────────────────────────────────────────────────

  const removeItem = (item: Capture) => {
    const items = gallery.items;
    const i = items.findIndex((c) => c.id === item.id);
    void gallery.remove(item.id);
    // Stay in the viewer on a neighbour, or leave it when that was the last one.
    if (items.length <= 1) setViewing(null);
    else setViewing(Math.min(i, items.length - 2));
    notify.undo(`${item.kind === 'photo' ? 'Photo' : 'Video'} deleted`, () => void gallery.restore(item));
  };

  const clearAll = async () => {
    confirming.current = true;
    const n = gallery.items.length;
    const ok = await confirm({
      title: 'Clear all captures?',
      description: `This deletes ${n} ${n === 1 ? 'photo or video' : 'photos and videos'} from this device. Anything you haven’t downloaded is gone for good.`,
      confirmLabel: 'Clear all',
      destructive: true,
    });
    confirming.current = false;
    if (ok) {
      await gallery.clear();
      announce('All captures cleared');
    }
  };

  // ── bits ───────────────────────────────────────────────────────────────────

  const devices = camera.devices;
  const switchCamera = () => {
    if (devices.length < 2) return;
    const current = camera.info?.deviceId ?? prefs.deviceId;
    const i = devices.findIndex((d) => d.deviceId === current);
    const next = devices[(i + 1) % devices.length];
    if (next) setPref('deviceId', next.deviceId);
  };
  const recordSupported = canRecord();
  const mode = cap.mode;

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // A click on a toast's "Download" / "Undo" is outside the dialog but isn't a request to close it.
        const target = (details as { event?: Event } | undefined)?.event?.target;
        if (target instanceof Element && target.closest('[data-sonner-toaster]')) return;
        void requestClose();
      }}
    >
      <DialogContent
        ref={popupRef}
        hideClose
        size="xl"
        // The shutter is disabled until the picture is up, so focus the dialog itself first; the shutter takes focus as soon as it can.
        initialFocus={() => popupRef.current ?? true}
        className="flex h-[min(52rem,calc(100dvh-2rem))] min-h-[30rem] max-w-5xl flex-col overflow-hidden"
      >
        {/* The viewer covers the studio; keep the controls underneath out of the tab order while it's up. */}
        <div inert={viewing !== null} className="flex min-h-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2.5 border-b px-3 sm:px-4">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-text">
              <Aperture className="size-4" />
            </span>
            <DialogTitle>Camera</DialogTitle>
            <DialogDescription className="sr-only">Take photos and record videos. Everything stays on this device; nothing is uploaded.</DialogDescription>
            {live && (
              <span
                className="inline-flex h-6 items-center gap-1.5 rounded-sm bg-success-soft px-2 text-xs font-medium text-success-text"
                title="The camera is on. Nothing leaves this device."
              >
                <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-success" />
                Camera on
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground max-md:hidden">{live ? camera.info?.label : ''}</span>
            <span className="flex-1 md:hidden" />
            <SettingsPopover
              devices={devices}
              info={camera.info}
              deviceId={prefs.deviceId}
              onDevice={(id) => setPref('deviceId', id)}
              resolution={prefs.resolution}
              onResolution={(r) => setPref('resolution', r)}
              shutterSound={prefs.shutterSound}
              onShutterSound={(on) => setPref('shutterSound', on)}
              soundsEnabled={soundsEnabled}
              disabled={cap.recording !== null}
            />
            <ShortcutsPopover />
            <IconButton label="Close" shortcut="Esc" onClick={() => void requestClose()}>
              <X />
            </IconButton>
          </header>

          <Stage
            status={camera.status}
            info={camera.info}
            videoRef={camera.videoRef}
            mirror={mirror}
            filterCss={filterCss}
            grid={prefs.grid}
            aspect={prefs.aspect}
            counting={cap.counting}
            flashKey={cap.flashKey}
            recording={cap.recording}
            onCancelTimer={cap.cancelCountdown}
            onAllow={camera.start}
            topRight={
              <>
                <StageButton label="Mirror" shortcut="M" pressed={mirror} onClick={toggleMirror}>
                  <FlipHorizontal2 />
                </StageButton>
                <StageButton label="Grid" shortcut="G" pressed={prefs.grid} onClick={() => setPref('grid', !prefs.grid)}>
                  <Grid3x3 />
                </StageButton>
                <StageButton
                  label={`Self-timer: ${timerLabel(prefs.timer)}`}
                  shortcut="T"
                  active={prefs.timer > 0}
                  changed={prefs.timer > 0}
                  text={prefs.timer > 0 ? `${prefs.timer}s` : undefined}
                  disabled={busy}
                  onClick={() => setPref('timer', nextTimer(prefs.timer))}
                >
                  <Timer />
                </StageButton>
                <StageButton
                  label={`Aspect ratio: ${ASPECTS.find((a) => a.id === prefs.aspect)?.label ?? ''}`}
                  shortcut="A"
                  active={prefs.aspect !== 'original'}
                  changed={prefs.aspect !== 'original'}
                  text={prefs.aspect !== 'original' ? prefs.aspect : undefined}
                  disabled={cap.recording !== null}
                  onClick={() => setPref('aspect', nextAspect(prefs.aspect))}
                >
                  <Crop />
                </StageButton>
                <AdjustPopover adjust={adjust} onAdjust={setAdjust} info={camera.info} onZoom={camera.setZoom} />
              </>
            }
          />

          <div className="shrink-0 space-y-2.5 border-t bg-popover pb-2.5 pt-3">
            <FilterStrip
              value={prefs.filter}
              onChange={(id) => {
                setPref('filter', id);
                announce(`${FILTERS.find((f) => f.id === id)?.label ?? ''} filter`);
              }}
            />

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
              <div className="flex items-center">
                <Segmented<CaptureMode>
                  aria-label="Capture mode"
                  value={mode}
                  onValueChange={cap.setMode}
                  options={recordSupported ? MODE_OPTIONS : MODE_OPTIONS.slice(0, 1)}
                  disabled={cap.recording !== null}
                />
              </div>
              <Shutter
                ref={shutterRef}
                mode={mode}
                recording={cap.recording !== null}
                counting={cap.counting !== null}
                disabled={!live || (mode === 'video' && !recordSupported)}
                onPress={cap.shutter}
              />
              <div className="flex items-center justify-end gap-1">
                {mode === 'video' && (
                  <IconButton
                    label={prefs.mic ? 'Microphone on' : 'Microphone off'}
                    aria-pressed={prefs.mic}
                    disabled={cap.recording !== null}
                    onClick={() => setPref('mic', !prefs.mic)}
                    className={cn(prefs.mic && 'text-foreground')}
                  >
                    {prefs.mic ? <Mic /> : <MicOff />}
                  </IconButton>
                )}
                {devices.length > 1 && (
                  <IconButton label="Switch camera" disabled={cap.recording !== null || !live} onClick={switchCamera}>
                    <SwitchCamera />
                  </IconButton>
                )}
              </div>
            </div>

            <Filmstrip
              items={gallery.items}
              loaded={gallery.loaded}
              unavailable={gallery.unavailable}
              lastAddedId={gallery.lastAddedId}
              onOpen={setViewing}
              onClear={() => void clearAll()}
            />
          </div>
        </div>

        <AnimatePresence>
          {viewing !== null && gallery.items[viewing] && (
            <Lightbox key="lightbox" items={gallery.items} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} onDelete={removeItem} />
          )}
        </AnimatePresence>

        <LiveRegion message={message} />
      </DialogContent>
    </Dialog>
  );
}

export default CameraStudio;
