import { Check, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { UsernameStatus } from '@/lib/supabase/username';

/** The line under a username field: the problem if there is one, otherwise whether the name is free. */
export function UsernameHint({
  id,
  error,
  status,
  idleText,
  className,
}: {
  id: string;
  error: string | null;
  status: UsernameStatus;
  idleText?: string;
  className?: string;
}) {
  let body: React.ReactNode = idleText ?? null;
  let tone = 'text-subtle-foreground';
  if (error) {
    body = error;
    tone = 'text-destructive-text';
  } else if (status === 'checking') {
    body = (
      <>
        <LoaderCircle className="size-3 animate-spin" /> Checking…
      </>
    );
    tone = 'text-muted-foreground';
  } else if (status === 'available') {
    body = (
      <>
        <Check className="size-3" /> Available
      </>
    );
    tone = 'text-success-text';
  }
  return (
    <p id={id} role={error ? 'alert' : 'status'} className={cn('mt-1 flex min-h-4 items-center gap-1 text-xs', tone, className)}>
      {body}
    </p>
  );
}
