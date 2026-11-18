import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Card } from '@/components/ui';
import { cn } from '@/lib/cn';
import { type Section, useNavStore } from '@/store/useNavStore';

/** The shared frame for every Home widget: icon + title on the left, an optional action on the right. */
export function WidgetCard({
  icon: Icon,
  title,
  action,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card
      className={cn('h-full min-h-40 gap-0 p-4', '[&>header]:min-h-6', className)}
      title={
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-brand-text" aria-hidden="true" />
          {title}
        </span>
      }
      action={action}
    >
      {children}
    </Card>
  );
}

/** A small “Open” button that jumps to the full view of whatever the widget summarises. */
export function OpenLink({ to, label = 'Open' }: { to: Section; label?: string }) {
  const go = useNavStore((s) => s.go);
  return (
    <Button variant="ghost" size="xs" onClick={() => go(to)}>
      {label}
    </Button>
  );
}

/** What a widget shows when it has nothing yet — one calm line plus an optional action. */
export function WidgetEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-2 py-2">
      <p className="text-[13px] leading-snug text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}
