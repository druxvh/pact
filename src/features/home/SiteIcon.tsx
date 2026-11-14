import { useState } from 'react';
import { cn } from '@/lib/cn';
import { faviconUrl } from '@/lib/ext';
import { hueFrom } from '@/lib/format';
import { hostnameOf } from '@/lib/url';

/** Coloured letter tile — the private fallback when no favicon is available. */
export function LetterTile({ label, className }: { label: string; className?: string }) {
  const hue = hueFrom(label);
  return (
    <span
      aria-hidden="true"
      className={cn('grid size-full place-items-center rounded-lg text-sm font-semibold text-white', className)}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.14 ${hue}), oklch(0.46 0.15 ${(hue + 40) % 360}))` }}
    >
      {(Array.from(label.trim())[0] ?? '?').toUpperCase()}
    </span>
  );
}

/**
 * Site favicon via Chromium's local favicon cache (no third-party requests).
 * Falls back to a letter tile outside the extension or when the icon fails.
 */
export function SiteIcon({ url, title, size = 28 }: { url: string; title?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url, size * 2);
  const label = title || hostnameOf(url);
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {!src || failed ? (
        <LetterTile label={label} />
      ) : (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full rounded-md object-contain"
        />
      )}
    </span>
  );
}
