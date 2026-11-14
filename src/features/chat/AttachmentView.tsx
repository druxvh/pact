import { Dialog as D } from '@base-ui/react/dialog';
import { Download, ImageOff, X } from 'lucide-react';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton, Skeleton } from '@/components/ui';
import type { Attachment } from '@/features/chat/types';
import { useBlobUrl } from '@/features/chat/useBlobUrl';
import { formatBytes } from '@/lib/format';

export function AttachmentView({ attachment: a }: { attachment: Attachment }) {
  const { url, status } = useBlobUrl(a.id);
  const [open, setOpen] = useState(false);

  if (status === 'loading') return <Skeleton className="h-40 w-56 rounded-xl" />;
  if (status === 'missing' || !url) {
    return (
      <div className="flex h-24 w-56 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs text-muted-foreground">
        <ImageOff className="size-5" />
        Attachment unavailable
      </div>
    );
  }

  if (a.kind === 'video') {
    return (
      // biome-ignore lint/a11y/useMediaCaption: user-sent clips have no caption track
      <video controls preload="metadata" src={url} className="max-h-72 max-w-full rounded-xl bg-black" aria-label={a.name} />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block overflow-hidden rounded-xl outline-offset-2"
        aria-label={`Open ${a.name}`}
      >
        <img
          src={url}
          alt={a.name}
          width={a.width}
          height={a.height}
          style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}
          className="max-h-72 max-w-full object-cover transition-transform duration-300 ease-out-expo group-hover:scale-[1.03]"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" hideClose className="overflow-hidden bg-black/90 p-0">
          <DialogTitle className="sr-only">{a.name}</DialogTitle>
          <img src={url} alt={a.name} className="mx-auto max-h-[80vh] w-auto max-w-full object-contain" />
          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2 text-xs text-white/70">
            <span className="truncate">
              {a.name} · {formatBytes(a.size)}
            </span>
            <span className="flex items-center gap-1">
              <D.Close
                render={
                  <IconButton label="Close preview" tooltip={false} size="icon-sm" className="text-white/80 hover:bg-white/10 hover:text-white">
                    <X />
                  </IconButton>
                }
              />
              <IconButton
                label="Download"
                tooltip={false}
                size="icon-sm"
                className="text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = a.name;
                  link.click();
                }}
              >
                <Download />
              </IconButton>
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
