import { useEffect, useState } from 'react';
import { IMAGE_ASSET_ID } from '@/lib/appearance/wallpaper';
import { getAsset } from '@/lib/assets';
import { useAppearanceStore } from '@/store/useAppearanceStore';

/**
 * Paints an *image* wallpaper (colours/gradients/meshes are painted by CSS on <body>, so they appear instantly).
 * The image fades in once decoded; a dim layer of the page background colour sits over it so text stays legible.
 */
export function WallpaperLayer() {
  const wallpaper = useAppearanceStore((s) => s.wallpaper);
  const dim = useAppearanceStore((s) => s.dim);
  const blur = useAppearanceStore((s) => s.blur);
  const imageId = wallpaper.kind === 'image' ? wallpaper.id : null;
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!imageId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void getAsset(imageId ?? IMAGE_ASSET_ID)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (!cancelled) {
            setUrl(objectUrl);
            setReady(true);
          }
        };
        img.src = objectUrl;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  if (!imageId || !url) return null;
  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-20 bg-cover bg-center transition-opacity duration-700"
        style={{ backgroundImage: `url(${url})`, opacity: ready ? 1 : 0, ...(blur ? { filter: `blur(${blur}px)`, transform: 'scale(1.08)' } : null) }}
      />
      <div aria-hidden="true" className="fixed inset-0 -z-10 bg-background" style={{ opacity: dim / 100 }} />
    </>
  );
}
