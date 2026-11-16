import { ExternalLink } from 'lucide-react';
import { useLinkPreview } from './linkPreviews';

/** A preview card for one link, built by the server (so your browser never contacts the linked site just to show it). */
export function LinkPreviewCard({ url }: { url: string }) {
  const { preview, loading } = useLinkPreview(url);
  if (loading) return <div className="mt-1.5 h-16 max-w-md animate-pulse rounded-lg border bg-muted/40" aria-hidden="true" />;
  if (!preview || (!preview.title && !preview.description && !preview.image)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="group mt-1.5 flex max-w-md flex-col gap-1 overflow-hidden rounded-lg border border-l-4 border-l-brand/60 bg-card/60 p-3 transition-colors hover:bg-accent/50"
    >
      {preview.site && <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{preview.site}</span>}
      {preview.title && (
        <span className="flex items-start gap-1.5 text-sm font-semibold text-brand-text group-hover:underline">
          <span className="min-w-0 break-words">{preview.title}</span>
          <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-60" aria-hidden="true" />
        </span>
      )}
      {preview.description && <span className="line-clamp-3 text-[13px] text-muted-foreground">{preview.description}</span>}
      {preview.image && <img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="mt-1 max-h-56 w-full rounded-md object-cover" />}
    </a>
  );
}
