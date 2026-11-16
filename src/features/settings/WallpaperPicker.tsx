import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Segmented, Slider } from '@/components/ui';
import {
  GRADIENTS,
  IMAGE_ASSET_ID,
  type Legibility,
  legibility,
  MESHES,
  NO_WALLPAPER,
  processWallpaperImage,
  SOLIDS,
  suggestDims,
  type Wallpaper,
  type WallpaperKind,
  wallpaperBackground,
  wallpaperLuminance,
} from '@/lib/appearance/wallpaper';
import { deleteAsset, getAsset, putAsset } from '@/lib/assets';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { useThemeStore } from '@/store/useThemeStore';

const KINDS: Array<{ value: WallpaperKind; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'mesh', label: 'Mesh' },
  { value: 'image', label: 'Image' },
];

function Swatch({ background, label, selected, onClick }: { background: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className={cn(
        'h-12 rounded-md outline-offset-2 transition-[transform,box-shadow] duration-150 hover:scale-[1.04] active:scale-95',
        selected ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : 'ring-1 ring-black/10 dark:ring-white/15',
      )}
      style={{ background }}
    />
  );
}

/** Object URL for a stored asset (revoked on change/unmount). */
function useAssetUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let made: string | null = null;
    void getAsset(id)
      .then((blob) => {
        if (cancelled || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  return url;
}

function Hint({ level, ratio }: Legibility) {
  const text =
    level === 'good'
      ? 'Text will be easy to read over this wallpaper.'
      : level === 'fair'
        ? 'Text is readable but not crisp — raise Dim a little.'
        : 'Text will be hard to read here — raise Dim, or pick a calmer wallpaper.';
  return (
    <p
      className={cn(
        'flex items-center gap-2 text-xs',
        level === 'good' ? 'text-success-text' : level === 'fair' ? 'text-warning-text' : 'text-destructive-text',
      )}
      role="status"
    >
      <span className={cn('size-1.5 rounded-full', level === 'good' ? 'bg-success' : level === 'fair' ? 'bg-warning' : 'bg-destructive')} />
      {text} <span className="tabular text-subtle-foreground">({ratio.toFixed(1)}:1)</span>
    </p>
  );
}

/** Miniature of the app over the current wallpaper — what you pick is what you get, dim included. */
function Preview({ background, imageUrl, dim, blur }: { background: string | null; imageUrl: string | null; dim: number; blur: number }) {
  return (
    <div className="relative isolate h-28 overflow-hidden rounded-lg border" aria-hidden="true">
      <div className="absolute inset-0 bg-background" />
      {background && <div className="absolute inset-0" style={{ background }} />}
      {imageUrl && (
        <div
          className="absolute inset-0 scale-110 bg-cover bg-center"
          style={{ backgroundImage: `url(${imageUrl})`, filter: blur ? `blur(${blur / 2}px)` : undefined }}
        />
      )}
      <div className="absolute inset-0 bg-background" style={{ opacity: dim / 100 }} />
      <div className="absolute inset-y-0 left-0 w-6 border-r bg-background/70" />
      <div className="absolute left-10 top-4 h-2 w-16 rounded-sm bg-foreground/70" />
      <div className="absolute left-10 top-8 h-1.5 w-24 rounded-sm bg-foreground/30" />
      <div className="absolute bottom-3 left-10 right-4 h-9 rounded-md border bg-card/80 backdrop-blur-sm" />
    </div>
  );
}

export function WallpaperPicker() {
  const wallpaper = useAppearanceStore((s) => s.wallpaper);
  const dims = useAppearanceStore((s) => s.dim);
  const blur = useAppearanceStore((s) => s.blur);
  const imageLuminance = useAppearanceStore((s) => s.imageLuminance);
  const { setWallpaper, setDim, setDims, setBlur } = useAppearanceStore.getState();
  const theme = useThemeStore((s) => s.resolved);
  const dim = dims[theme];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const imageUrl = useAssetUrl(wallpaper.kind === 'image' ? wallpaper.id : null);

  const kind = wallpaper.kind;

  /** Choose a wallpaper and let pact pick the dim that makes text readable; fine-tune with the slider afterwards. */
  const choose = (wp: Wallpaper, measured?: number | null) => {
    setWallpaper(wp, measured);
    const l = wallpaperLuminance(wp, measured ?? imageLuminance);
    if (l !== null) setDims(suggestDims(l));
  };
  const lum = wallpaperLuminance(wallpaper, imageLuminance);
  const background = wallpaperBackground(wallpaper);

  // gradient builder state mirrors the current gradient (or sensible starting colours)
  const g = wallpaper.kind === 'gradient' ? wallpaper : { kind: 'gradient' as const, from: '#7f7fd5', to: '#86a8e7', angle: 135 };

  const pickKind = (next: WallpaperKind) => {
    if (next === kind) return;
    switch (next) {
      case 'none':
        setWallpaper(NO_WALLPAPER);
        break;
      case 'solid':
        choose({ kind: 'solid', color: SOLIDS[0]?.color ?? '#0c0c10' });
        break;
      case 'gradient':
        choose({ kind: 'gradient', from: GRADIENTS[0]?.from ?? '#ff9a8b', to: GRADIENTS[0]?.to ?? '#6a5acd', angle: GRADIENTS[0]?.angle ?? 135 });
        break;
      case 'mesh':
        choose({ kind: 'mesh', id: MESHES[0]?.id ?? 'nebula' });
        break;
      case 'image':
        // keep the previously stored image if there is one
        void getAsset(IMAGE_ASSET_ID).then((blob) => {
          if (blob) choose({ kind: 'image', id: IMAGE_ASSET_ID, name: 'Wallpaper' });
          else fileRef.current?.click();
        });
        break;
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const processed = await processWallpaperImage(file);
      await putAsset(IMAGE_ASSET_ID, processed.blob);
      choose({ kind: 'image', id: IMAGE_ASSET_ID, name: file.name }, processed.luminance);
      notify.success('Wallpaper set', `${processed.width}×${processed.height} · ${(processed.blob.size / 1024).toFixed(0)} KB, stored on this device`);
    } catch (err) {
      notify.error('Couldn’t use that image', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async () => {
    await deleteAsset(IMAGE_ASSET_ID).catch(() => {});
    setWallpaper(NO_WALLPAPER);
  };

  return (
    <div className="space-y-4">
      <Segmented<WallpaperKind> aria-label="Wallpaper type" value={kind} onValueChange={pickKind} options={KINDS} />

      {kind === 'solid' && wallpaper.kind === 'solid' && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {SOLIDS.map((s) => (
              <Swatch
                key={s.id}
                background={s.color}
                label={s.label}
                selected={wallpaper.color.toLowerCase() === s.color}
                onClick={() => choose({ kind: 'solid', color: s.color })}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input
              type="color"
              value={wallpaper.color}
              onChange={(e) => setWallpaper({ kind: 'solid', color: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
            Custom colour <span className="font-mono text-xs">{wallpaper.color}</span>
          </label>
        </div>
      )}

      {kind === 'gradient' && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {GRADIENTS.map((p) => {
              const css = `linear-gradient(${p.angle}deg,${p.from},${p.to})`;
              const sel = wallpaper.kind === 'gradient' && wallpaper.from === p.from && wallpaper.to === p.to;
              return (
                <Swatch
                  key={p.id}
                  background={css}
                  label={p.label}
                  selected={sel}
                  onClick={() => choose({ kind: 'gradient', from: p.from, to: p.to, angle: p.angle })}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-background/40 p-3 text-[13px]">
            <span className="text-muted-foreground">Make your own</span>
            <input
              type="color"
              aria-label="Gradient start colour"
              value={g.from}
              onChange={(e) => setWallpaper({ ...g, from: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
            <input
              type="color"
              aria-label="Gradient end colour"
              value={g.to}
              onChange={(e) => setWallpaper({ ...g, to: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
            />
            <div className="flex min-w-40 flex-1 items-center gap-3">
              <span className="tabular w-12 text-xs text-muted-foreground">{Math.round(g.angle)}°</span>
              <Slider aria-label="Gradient angle" value={g.angle} min={0} max={360} onValueChange={(angle) => setWallpaper({ ...g, angle })} />
            </div>
          </div>
        </div>
      )}

      {kind === 'mesh' && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {MESHES.map((m) => {
            const css = wallpaperBackground({ kind: 'mesh', id: m.id }) ?? m.base;
            return (
              <Swatch
                key={m.id}
                background={css}
                label={m.label}
                selected={wallpaper.kind === 'mesh' && wallpaper.id === m.id}
                onClick={() => choose({ kind: 'mesh', id: m.id })}
              />
            );
          })}
        </div>
      )}

      {kind === 'image' && (
        // biome-ignore lint/a11y/noStaticElementInteractions: a drag-and-drop target only; the "Choose image" button inside is the keyboard path
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void importFile(e.dataTransfer.files[0]);
          }}
          className={cn('flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 transition-colors', dragging && 'border-brand bg-brand-soft')}
        >
          {imageUrl ? (
            <img src={imageUrl} alt="" className="h-14 w-24 rounded-md border object-cover" />
          ) : (
            <div className="grid h-14 w-24 place-items-center rounded-md border bg-muted text-muted-foreground">
              <ImagePlus className="size-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{wallpaper.kind === 'image' ? wallpaper.name : 'No image yet'}</p>
            <p className="text-xs text-muted-foreground">Drop an image here or choose one. It’s resized and stored on this device only.</p>
          </div>
          <Button variant="outline" size="sm" loading={busy} onClick={() => fileRef.current?.click()}>
            <ImagePlus /> {wallpaper.kind === 'image' ? 'Replace' : 'Choose image'}
          </Button>
          {wallpaper.kind === 'image' && (
            <Button variant="danger" size="sm" onClick={() => void removeImage()}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a wallpaper image"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void importFile(f);
        }}
      />

      {kind !== 'none' && (
        <>
          <Preview background={background} imageUrl={imageUrl} dim={dim} blur={blur} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex justify-between text-[13px]">
                <span className="font-medium">
                  Dim <span className="font-normal text-muted-foreground">· {theme} theme</span>
                </span>
                <span className="tabular text-muted-foreground">{dim}%</span>
              </div>
              <Slider aria-label={`Dim (${theme} theme)`} value={dim} min={0} max={80} onValueChange={(v) => setDim(theme, v)} />
            </div>
            {kind === 'image' && (
              <div>
                <div className="mb-2 flex justify-between text-[13px]">
                  <span className="font-medium">Blur</span>
                  <span className="tabular text-muted-foreground">{blur}px</span>
                </div>
                <Slider aria-label="Blur" value={blur} min={0} max={24} onValueChange={setBlur} />
              </div>
            )}
          </div>
          {lum !== null && <Hint {...legibility(lum, dim, theme)} />}
        </>
      )}
    </div>
  );
}
