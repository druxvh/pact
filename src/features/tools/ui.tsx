import { Check, Copy } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/ui';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

/** Copy button that morphs to a check for a moment. Silent (no toast) — the icon is the feedback. */
export function CopyButton({
  text,
  label = 'Copy',
  size = 'icon-sm',
  disabled,
  className,
}: {
  text: string;
  label?: string;
  size?: 'icon-xs' | 'icon-sm' | 'icon';
  disabled?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <IconButton
      label={copied ? 'Copied' : label}
      size={size}
      disabled={disabled || !text}
      className={className}
      onClick={async () => {
        if (!(await copyText(text, ''))) return;
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? 'yes' : 'no'}
          initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={spring.snappy}
          className="grid place-items-center"
        >
          {copied ? <Check className="text-success-text" /> : <Copy />}
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}

/** Label + control stack used throughout the tool panels. */
export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {hint && <span className="text-[11px] text-subtle-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** A read-only value with a copy button. */
export function ResultRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 py-1.5 pl-3 pr-1.5">
      <span className="w-14 shrink-0 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">{label}</span>
      <span className={cn('min-w-0 flex-1 truncate text-[13px]', mono && 'font-mono')} title={value}>
        {value || '—'}
      </span>
      <CopyButton text={value} size="icon-xs" label={`Copy ${label}`} />
    </div>
  );
}

/** Output box with an optional error state. */
export function OutputBox({
  value,
  error,
  className,
  placeholder = 'Result appears here',
}: {
  value: string;
  error?: string | null;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div
      className={cn(
        'relative min-h-24 rounded-lg border bg-muted/40 p-3 pr-10 font-mono text-[13px] leading-relaxed',
        error && 'border-destructive/40 bg-destructive-soft',
        className,
      )}
    >
      {error ? (
        <p className="font-sans text-[13px] text-destructive-text">{error}</p>
      ) : value ? (
        <pre className="whitespace-pre-wrap break-all">{value}</pre>
      ) : (
        <p className="font-sans text-subtle-foreground">{placeholder}</p>
      )}
      {!error && value && <CopyButton text={value} size="icon-xs" className="absolute right-2 top-2" />}
    </div>
  );
}
