import { Camera, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Slider,
  Spinner,
} from '@/components/ui';
import {
  ACCEPTED_AVATAR_TYPES,
  AVATAR_BOX,
  AVATAR_OUT,
  avatarFileError,
  type Crop,
  clampCrop,
  clampZoom,
  coverScale,
  MAX_ZOOM,
  MIN_ZOOM,
  sourceRect,
} from '@/lib/avatarCrop';
import { setAvatar, useProfileSync } from '@/lib/supabase/profile';
import { notify } from '@/lib/toast';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { useUserStore } from '@/store/useUserStore';

/** Drag to position, slide to zoom, save a 256×256 WebP. */
export function CropDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const apply = (next: Crop) => size && setCrop(clampCrop(size.w, size.h, next));
  const scale = size ? coverScale(size.w, size.h) * crop.zoom : 1;

  const save = async () => {
    const img = imgRef.current;
    if (!img || !size) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_OUT;
      canvas.height = AVATAR_OUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.imageSmoothingQuality = 'high';
      const r = sourceRect(size.w, size.h, crop);
      ctx.drawImage(img, r.sx, r.sy, r.size, r.size, 0, 0, AVATAR_OUT, AVATAR_OUT);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.88));
      if (blob?.type !== 'image/webp') {
        notify.error('Couldn’t prepare that photo', 'This browser can’t encode WebP images.');
        return;
      }
      if (await setAvatar(blob)) {
        notify.success('Photo updated');
        onClose();
      }
    } catch {
      notify.error('Couldn’t prepare that photo', 'Try a different image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Adjust your photo</DialogTitle>
          <DialogDescription>Drag to reposition, use the slider to zoom.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div
            className="relative mx-auto touch-none cursor-grab select-none overflow-hidden rounded-lg bg-muted active:cursor-grabbing"
            style={{ width: AVATAR_BOX, height: AVATAR_BOX }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) apply({ ...crop, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onWheel={(e) => apply({ ...crop, zoom: clampZoom(crop.zoom - e.deltaY / 400) })}
          >
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: size ? size.w : undefined,
                height: size ? size.h : undefined,
                transform: `translate(-50%, -50%) translate(${crop.x}px, ${crop.y}px) scale(${scale})`,
                opacity: size ? 1 : 0,
              }}
            />
            {/* a faint rule-of-thirds grid so it's clear what will be kept */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/20 [background:linear-gradient(to_right,transparent_33%,oklch(1_0_0/.18)_33%_calc(33%+1px),transparent_calc(33%+1px)_66%,oklch(1_0_0/.18)_66%_calc(66%+1px),transparent_calc(66%+1px)),linear-gradient(to_bottom,transparent_33%,oklch(1_0_0/.18)_33%_calc(33%+1px),transparent_calc(33%+1px)_66%,oklch(1_0_0/.18)_66%_calc(66%+1px),transparent_calc(66%+1px))]"
            />
            {!size && (
              <div className="absolute inset-0 grid place-items-center">
                <Spinner />
              </div>
            )}
          </div>
          <Slider aria-label="Zoom" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={crop.zoom} onValueChange={(zoom) => apply({ ...crop, zoom })} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!size || busy}>
            {busy ? 'Saving…' : 'Save photo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The profile picture with Change / Remove. Only offered when signed in (guests have no account to attach it to). */
export function AvatarEditor({ name }: { name: string }) {
  const src = useUserStore((s) => s.currentUser.avatarUrl);
  const signedIn = useAuthStore(selectSignedIn);
  const ready = useProfileSync((s) => s.ready);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState(false);
  const canEdit = signedIn && ready;

  return (
    <div className="flex items-center gap-4">
      <div className="group relative shrink-0">
        <Avatar name={name} src={src} size="xl" className="size-[72px] text-2xl" />
        {canEdit && (
          <button
            type="button"
            aria-label="Change photo"
            onClick={() => input.current?.click()}
            className="absolute inset-0 grid place-items-center rounded-lg bg-black/55 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Camera className="size-5" />
          </button>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <p className="truncate text-base font-semibold tracking-tight">{name}</p>
        {signedIn ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => input.current?.click()}>
              <Camera /> {src ? 'Change photo' : 'Upload photo'}
            </Button>
            {src && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canEdit || removing}
                onClick={async () => {
                  setRemoving(true);
                  if (await setAvatar(null)) notify.success('Photo removed');
                  setRemoving(false);
                }}
              >
                <Trash2 /> Remove
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sign in to add a profile photo.</p>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_AVATAR_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a profile photo"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ''; // so picking the same file again still fires
            if (!f) return;
            const problem = avatarFileError(f);
            if (problem) notify.error('That photo won’t work', problem);
            else setFile(f);
          }}
        />
      </div>
      {file && <CropDialog file={file} onClose={() => setFile(null)} />}
    </div>
  );
}
