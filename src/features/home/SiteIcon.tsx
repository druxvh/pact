import { useState } from 'react';
import { brandFor, hexLightness } from '@/features/home/brandIcons';
import { cn } from '@/lib/cn';
import { faviconUrl } from '@/lib/ext';
import { hostnameOf } from '@/lib/url';

/** Neutral monogram — the quiet fallback when a site has no known brand mark and no cached favicon. */
export function Monogram({ label, className }: { label: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('grid size-full place-items-center rounded-[inherit] bg-muted font-semibold text-muted-foreground', className)}>
      {(Array.from(label.trim())[0] ?? '?').toUpperCase()}
    </span>
  );
}

/**
 * A site's icon, best source first:
 *   1. a bundled brand mark for well-known sites (instant, offline, always crisp),
 *   2. the browser's own favicon cache (needs the extension; private — no third-party request),
 *   3. a neutral monogram.
 * It sits on a white chip so black-on-transparent favicons stay visible in dark theme — as in Chrome's own new tab.
 */
export function SiteIcon({
  url,
  title,
  size = 40,
  chip = true,
  className,
}: {
  url: string;
  title?: string;
  size?: number;
  chip?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const brand = brandFor(url);
  const label = title || hostnameOf(url);
  const glyph = Math.round(size * (chip ? 0.56 : 0.9));
  const favicon = !brand && !failed ? faviconUrl(url, glyph * 2) : '';

  // Very light brand colours (e.g. yellow) would vanish on white: invert to a coloured chip with a dark glyph.
  const pale = brand ? hexLightness(brand.hex) > 0.72 : false;

  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden',
        chip && (pale ? 'rounded-lg' : 'rounded-lg bg-white shadow-xs ring-1 ring-black/[0.06] dark:ring-white/10'),
        !chip && 'rounded-md',
        className,
      )}
      style={{ width: size, height: size, ...(chip && pale && brand ? { background: brand.hex } : null) }}
    >
      {brand ? (
        <svg viewBox="0 0 24 24" width={glyph} height={glyph} role="img" aria-label={brand.title} fill={pale ? '#111' : brand.hex}>
          <path d={brand.path} />
        </svg>
      ) : favicon ? (
        <img src={favicon} alt="" width={glyph} height={glyph} loading="lazy" draggable={false} onError={() => setFailed(true)} className="object-contain" />
      ) : (
        <Monogram label={label} className={chip ? 'text-sm' : 'text-xs'} />
      )}
    </span>
  );
}
