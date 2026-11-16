import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import type * as React from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.soft}
      className={cn('flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-8 text-center', className)}
    >
      <div className="mb-2 grid size-11 animate-float place-items-center rounded-lg bg-brand-soft text-brand-text">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-xs text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </motion.div>
  );
}
