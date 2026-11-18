/** The dark viewfinder: the live picture inside its crop frame, with the grid, countdown, flash, REC pill and whatever the studio puts on top. */
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, type RefObject, useState } from 'react';
import { type AspectId, aspectRatio } from '@/features/camera/geometry';
import { formatElapsed, MAX_RECORD_MS } from '@/features/camera/recorder';
import { ErrorPanel, ExplainerPanel, StartingPanel } from '@/features/camera/StatePanel';
import type { CameraInfo, StreamStatus } from '@/features/camera/useCameraStream';
import type { RecordingState } from '@/features/camera/useCapture';
import { useMotionOff } from '@/features/camera/useMotionOff';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

type StageProps = {
  status: StreamStatus;
  info: CameraInfo | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  mirror: boolean;
  /** The CSS filter string for the current look (`none` when plain). */
  filterCss: string;
  grid: boolean;
  aspect: AspectId;
  counting: number | null;
  flashKey: number;
  recording: RecordingState | null;
  onCancelTimer: () => void;
  onAllow: () => void;
  /** The option buttons, top right (the REC pill takes the top left). */
  topRight: ReactNode;
};

function GridLines() {
  const line = 'absolute bg-white/40 shadow-[0_0_0_0.5px_rgb(0_0_0/0.3)]';
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className={cn(line, 'inset-y-0 left-1/3 w-px')} />
      <span className={cn(line, 'inset-y-0 left-2/3 w-px')} />
      <span className={cn(line, 'inset-x-0 top-1/3 h-px')} />
      <span className={cn(line, 'inset-x-0 top-2/3 h-px')} />
    </div>
  );
}

function RecPill({ recording }: { recording: RecordingState }) {
  const remaining = MAX_RECORD_MS - recording.elapsedMs;
  return (
    <div
      role="timer"
      aria-label="Recording time"
      className="flex h-9 items-center gap-2 rounded-md bg-black/55 px-3 text-[13px] font-medium text-white backdrop-blur-sm"
    >
      <span aria-hidden="true" className={cn('size-2.5 rounded-full bg-destructive', recording.paused ? 'opacity-50' : 'animate-pulse')} />
      <span className="font-semibold tracking-wide">{recording.paused ? 'PAUSED' : 'REC'}</span>
      <span className="tabular-nums">{formatElapsed(recording.elapsedMs)}</span>
      <span className={cn('hidden tabular-nums sm:inline', remaining <= 30_000 ? 'text-warning' : 'text-white/55')}>/ {formatElapsed(MAX_RECORD_MS)}</span>
    </div>
  );
}

export function Stage({
  status,
  info,
  videoRef,
  mirror,
  filterCss,
  grid,
  aspect,
  counting,
  flashKey,
  recording,
  onCancelTimer,
  onAllow,
  topRight,
}: StageProps) {
  const motionOff = useMotionOff();
  // The picture's own shape, as the browser reports it, so "Original" frames it exactly.
  const [native, setNative] = useState<number | null>(null);
  const live = status.phase === 'live';
  const ratio = aspectRatio(aspect) ?? native ?? (info?.height ? info.width / info.height : 16 / 9);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-black text-white [container-type:size]" data-camera-stage>
      <div className={cn('absolute inset-0 grid place-items-center transition-opacity duration-300', live ? 'opacity-100' : 'opacity-0')}>
        <div className="relative overflow-hidden ring-1 ring-white/10" style={{ aspectRatio: ratio, width: `min(100cqw, calc(100cqh * ${ratio}))` }}>
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            disablePictureInPicture
            aria-label="Camera preview"
            onLoadedMetadata={(e) => setNative(e.currentTarget.videoHeight ? e.currentTarget.videoWidth / e.currentTarget.videoHeight : null)}
            onResize={(e) => setNative(e.currentTarget.videoHeight ? e.currentTarget.videoWidth / e.currentTarget.videoHeight : null)}
            className="absolute inset-0 size-full max-w-none object-cover"
            style={{ transform: mirror ? 'scaleX(-1)' : undefined, filter: filterCss === 'none' ? undefined : filterCss }}
          />
          {grid && <GridLines />}
        </div>
      </div>

      {status.phase === 'starting' && <StartingPanel />}
      {status.phase === 'paused' && <StartingPanel />}
      {status.phase === 'explain' && <ExplainerPanel onAllow={onAllow} />}
      {status.phase === 'error' && <ErrorPanel error={status.error} onRetry={onAllow} />}

      {/* the flash: a quick white wash (skipped when animations are reduced) */}
      {flashKey > 0 && !motionOff && (
        <motion.div
          key={flashKey}
          aria-hidden="true"
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 bg-white"
        />
      )}

      {/* the self-timer */}
      <AnimatePresence>
        {counting !== null && (
          <motion.div
            key="countdown"
            initial={motionOff ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={motionOff ? undefined : { opacity: 0 }}
            className="absolute inset-0 z-10 grid place-items-center bg-black/35"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={counting}
                aria-hidden="true"
                initial={motionOff ? false : { scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={motionOff ? undefined : { scale: 0.85, opacity: 0 }}
                transition={spring.soft}
                className="text-[length:min(40cqh,9rem)] font-semibold leading-none tabular-nums text-white drop-shadow-[0_4px_24px_rgb(0_0_0/0.55)]"
              >
                {counting}
              </motion.span>
            </AnimatePresence>
            <button
              type="button"
              onClick={onCancelTimer}
              className="absolute bottom-5 h-9 rounded-md bg-black/60 px-4 text-[13px] font-medium text-white backdrop-blur-sm outline-none transition-colors hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white"
            >
              Cancel <span className="ml-1 text-white/55">Esc</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* top bar: REC pill on the left, option buttons on the right */}
      {live && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 bg-gradient-to-b from-black/45 to-transparent p-3 pb-8">
          <div className="pointer-events-auto">{recording && <RecPill recording={recording} />}</div>
          <div className="pointer-events-auto flex flex-wrap justify-end gap-1.5">{topRight}</div>
        </div>
      )}

      {live && info && info.width > 0 && !recording && (
        <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-sm bg-black/45 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white/70 backdrop-blur-sm">
          {info.width}×{info.height}
        </span>
      )}
    </div>
  );
}
