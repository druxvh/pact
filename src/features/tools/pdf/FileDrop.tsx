import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/** A big drop target that is also a real button (keyboard and screen-reader friendly). */
export function FileDrop({
  accept,
  multiple = true,
  onFiles,
  title,
  hint,
  compact,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) onFiles(multiple ? files : files.slice(0, 1));
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-center transition-colors',
          compact ? 'px-4 py-4' : 'px-6 py-12',
          over ? 'border-brand bg-brand-soft' : 'hover:border-foreground/30 hover:bg-accent/40',
        )}
      >
        <FileUp className={cn('text-brand-text', compact ? 'size-5' : 'size-7')} aria-hidden="true" />
        <span className="text-sm font-medium">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </button>
    </>
  );
}

/** Problems from reading files, shown once and dismissible by loading again. */
export function Problems({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul role="alert" className="space-y-1 rounded-md bg-destructive-soft px-3 py-2 text-[13px] text-destructive-text">
      {items.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}
