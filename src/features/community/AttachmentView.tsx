import { FileWarning } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui';
import type { Attachment } from './types';
import { getCommunityApi } from './useCommunityStore';

/** A member-only file, fetched through a short-lived signed URL. Images and GIFs open full-size on click. */
export function AttachmentView({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    getCommunityApi()
      .attachmentUrl(attachment.path)
      .then((u) => {
        if (cancelled) return;
        if (u) setUrl(u);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [attachment.path]);

  const isVideo = attachment.type.startsWith('video/');
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : null;
  const box = ratio ? { aspectRatio: String(ratio), maxHeight: 320, maxWidth: Math.min(420, 320 * ratio) } : { maxHeight: 320, maxWidth: 420 };

  if (failed) {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <FileWarning className="size-4" aria-hidden="true" /> {attachment.name} couldn’t be loaded
      </span>
    );
  }
  if (!url)
    return (
      <div className="mt-1.5 h-40 w-64 animate-pulse rounded-lg bg-muted/50" style={ratio ? { aspectRatio: String(ratio) } : undefined} aria-hidden="true" />
    );

  if (isVideo) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: member-uploaded clips have no caption track to offer
      <video src={url} controls preload="metadata" className="mt-1.5 w-full rounded-lg bg-black" style={box} aria-label={attachment.name} />
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 block overflow-hidden rounded-lg border outline-offset-2"
        style={box}
        aria-label={`Open ${attachment.name}`}
      >
        <img src={url} alt={attachment.name} loading="lazy" className="size-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" className="bg-black/90 p-2">
          <DialogTitle className="sr-only">{attachment.name}</DialogTitle>
          <img src={url} alt={attachment.name} className="mx-auto max-h-[80vh] max-w-full rounded-md object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
