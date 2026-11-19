/** The filmstrip of recent captures under the controls, and the lightbox that opens when you pick one. */
import { ChevronLeft, ChevronRight, Copy, Download, Lock, Play, Trash2, Video, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { IconButton } from '@/components/ui';
import { blobToPng, captureFilename } from '@/features/camera/capture';
import type { Capture } from '@/features/camera/gallery';
import { StageButton } from '@/features/camera/parts';
import { formatElapsed } from '@/features/camera/recorder';
import { useMotionOff } from '@/features/camera/useMotionOff';
import { useObjectUrl } from '@/features/camera/useObjectUrl';
import { cn } from '@/lib/cn';
import { downloadBlob } from '@/lib/download';
import { formatBytes, relativeTime } from '@/lib/format';
import { spring } from '@/lib/motion';
import { notify } from '@/lib/toast';

const noun = (c: Capture) => (c.kind === 'photo' ? 'Photo' : 'Video');

// ── filmstrip ────────────────────────────────────────────────────────────────

function Thumb({ item, highlight, onOpen, animate }: { item: Capture; highlight: boolean; onOpen: () => void; animate: boolean }) {
  // The small JPEG if there is one; for a photo the file itself is the fallback. A clip with no poster gets an icon.
  const url = useObjectUrl(item.thumb.size > 0 ? item.thumb : item.kind === 'photo' ? item.blob : null);
  return (
    <motion.li
      layout={animate ? 'position' : false}
      // Only the capture that was just taken pops in; the rest are simply there.
      initial={animate && highlight ? { opacity: 0, scale: 0.6 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring.bouncy}
      className="shrink-0"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${noun(item)}, ${relativeTime(item.createdAt)}. Open`}
        className={cn(
          'relative block size-14 overflow-hidden [@media(max-height:680px)]:size-11 rounded-md border bg-muted outline-none transition-shadow duration-300',
          'hover:ring-2 hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring',
          highlight && 'ring-2 ring-brand',
        )}
      >
        {url ? (
          <img src={url} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <Video aria-hidden="true" className="m-auto size-5 text-muted-foreground" />
        )}
        {item.kind === 'video' && (
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-1 pb-0.5 pt-3 text-[10px] font-medium leading-none text-white">
            <Play aria-hidden="true" className="size-2.5 fill-current" />
            <span className="tabular-nums">{formatElapsed(item.durationMs ?? 0)}</span>
          </span>
        )}
      </button>
    </motion.li>
  );
}

export function Filmstrip({
  items,
  loaded,
  unavailable,
  lastAddedId,
  onOpen,
  onClear,
}: {
  items: Capture[];
  loaded: boolean;
  unavailable: boolean;
  lastAddedId: string | null;
  onOpen: (index: number) => void;
  onClear: () => void;
}) {
  const motionOff = useMotionOff();
  if (!loaded) return <div className="h-8" aria-hidden="true" />;
  if (items.length === 0) {
    return (
      <p className="flex h-8 items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
        <Lock aria-hidden="true" className="size-3.5 shrink-0" />
        {unavailable ? 'This browser can’t keep captures — download them as you go.' : 'Your photos and videos show up here. They stay on this device.'}
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 pl-4 pr-3">
      <ul aria-label="Recent captures" className="no-scrollbar -mx-0.5 flex min-w-0 flex-1 list-none gap-2 overflow-x-auto p-0 px-0.5 py-0.5">
        {items.map((item, i) => (
          <Thumb key={item.id} item={item} animate={!motionOff} highlight={item.id === lastAddedId} onOpen={() => onOpen(i)} />
        ))}
      </ul>
      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
        {items.length} {items.length === 1 ? 'item' : 'items'}
      </span>
      <IconButton label="Clear all" size="icon-sm" onClick={onClear}>
        <Trash2 />
      </IconButton>
    </div>
  );
}

// ── lightbox ─────────────────────────────────────────────────────────────────

/** MediaRecorder's files have no duration in the header, so a player shows an endless clip that can't seek. Jumping to the end once fixes it. */
function fixInfiniteDuration(video: HTMLVideoElement) {
  if (video.duration !== Number.POSITIVE_INFINITY) return;
  const restore = () => {
    video.removeEventListener('timeupdate', restore);
    video.currentTime = 0;
  };
  video.addEventListener('timeupdate', restore);
  video.currentTime = 1e101;
}

async function copyImage(blob: Blob) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    notify.error('Copying images isn’t supported here', 'Use Download instead.');
    return;
  }
  try {
    // A promise keeps the click's permission alive while the PNG is made (Chromium only takes PNG).
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobToPng(blob) })]);
    notify.success('Image copied');
  } catch {
    notify.error('Couldn’t copy the image', 'The browser blocked clipboard access. Use Download instead.');
  }
}

export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
  onDelete,
}: {
  items: Capture[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onDelete: (item: Capture) => void;
}) {
  const motionOff = useMotionOff();
  const item = items[index];
  const url = useObjectUrl(item?.blob);
  const root = useRef<HTMLDivElement>(null);

  // Take focus on open so ←/→ work straight away (the studio below is inert while this is up).
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  if (!item) return null;
  const count = items.length;
  const go = (delta: number) => onIndex((index + delta + count) % count);
  const download = () => downloadBlob(captureFilename(item.kind, item.mime, new Date(item.createdAt)), item.blob);

  return (
    <motion.div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={`${noun(item)} ${index + 1} of ${count}`}
      tabIndex={-1}
      initial={motionOff ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={motionOff ? undefined : { opacity: 0 }}
      transition={{ duration: 0.18 }}
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          go(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          go(1);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          onDelete(item);
        }
      }}
      className="absolute inset-0 z-30 flex flex-col bg-black text-white outline-none"
    >
      <div className="flex items-center gap-2 p-3">
        <StageButton label="Back to camera" onClick={onClose} className="bg-white/10 hover:bg-white/20">
          <X />
        </StageButton>
        <p className="min-w-0 flex-1 truncate text-[13px] text-white/70">
          <span className="font-medium text-white">
            {index + 1} / {count}
          </span>
          <span className="hidden sm:inline">
            {' · '}
            {noun(item)} · {item.width}×{item.height} · {formatBytes(item.size)}
            {item.kind === 'video' && item.durationMs ? ` · ${formatElapsed(item.durationMs)}` : ''} · {relativeTime(item.createdAt)}
          </span>
        </p>
        <StageButton label="Download" onClick={download} className="bg-white/10 hover:bg-white/20">
          <Download />
        </StageButton>
        {item.kind === 'photo' && (
          <StageButton label="Copy image" onClick={() => void copyImage(item.blob)} className="bg-white/10 hover:bg-white/20">
            <Copy />
          </StageButton>
        )}
        <StageButton label="Delete" shortcut="Del" onClick={() => onDelete(item)} className="bg-white/10 hover:bg-destructive">
          <Trash2 />
        </StageButton>
      </div>

      <div className="relative min-h-0 flex-1">
        {/* The media fills this box and `object-contain` fits it: percentage max-sizes don't resolve inside a flex/grid cell. */}
        {url &&
          (item.kind === 'photo' ? (
            <img
              key={item.id}
              src={url}
              alt={`Captured ${relativeTime(item.createdAt)}`}
              className="absolute inset-0 size-full max-w-none object-contain px-3 pb-3"
            />
          ) : (
            // biome-ignore lint/a11y/useMediaCaption: a clip you recorded yourself has no captions to offer
            <video
              key={item.id}
              src={url}
              controls
              playsInline
              onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)}
              className="absolute inset-0 size-full max-w-none bg-black object-contain px-3 pb-3"
            />
          ))}
        {count > 1 && (
          <>
            <StageButton label="Previous" shortcut="←" onClick={() => go(-1)} className="absolute left-3 top-1/2 h-11 min-w-11 -translate-y-1/2">
              <ChevronLeft />
            </StageButton>
            <StageButton label="Next" shortcut="→" onClick={() => go(1)} className="absolute right-3 top-1/2 h-11 min-w-11 -translate-y-1/2">
              <ChevronRight />
            </StageButton>
          </>
        )}
      </div>
    </motion.div>
  );
}
