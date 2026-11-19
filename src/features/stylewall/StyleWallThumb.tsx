import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { renderStill } from './still';

/**
 * A small picture of a style's wallpaper — the real scene's still frame at the current light/dark (see still.ts). It fills its parent;
 * until the frame is ready (the scene is a lazy chunk) the parent's own background shows through.
 */
export function StyleWallThumb({
  scene,
  dark,
  plate,
  accent,
  width = 240,
  height = 160,
  className,
}: {
  scene: string;
  dark: boolean;
  plate?: string;
  accent?: string;
  /** CSS pixels the frame is drawn for (it is then scaled to cover its parent). */
  width?: number;
  height?: number;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // after the picker has painted: building a still is a few tens of ms of canvas work
    const id = window.setTimeout(() => {
      void renderStill({ scene, w: width, h: height, dark, plate, accent }).then((u) => {
        if (!cancelled) setUrl(u);
      });
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [scene, dark, plate, accent, width, height]);
  if (!url) return null;
  return <img src={url} alt="" aria-hidden="true" draggable={false} className={cn('absolute inset-0 size-full object-cover', className)} />;
}
