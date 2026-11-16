import { motion } from 'motion/react';
import type { ComponentType } from 'react';
import { useHomeLayoutStore, type WidgetId } from '@/features/home/layout';
import { CountdownWidget } from '@/features/home/widgets/CountdownWidget';
import { FocusWidget } from '@/features/home/widgets/FocusWidget';
import { PinnedNotesWidget } from '@/features/home/widgets/PinnedNotesWidget';
import { QuickNoteWidget } from '@/features/home/widgets/QuickNoteWidget';
import { QuoteWidget } from '@/features/home/widgets/QuoteWidget';
import { TodayWidget } from '@/features/home/widgets/TodayWidget';
import { cn } from '@/lib/cn';
import { fadeUp } from '@/lib/motion';

const REGISTRY: Record<WidgetId, ComponentType> = {
  today: TodayWidget,
  focus: FocusWidget,
  pinned: PinnedNotesWidget,
  quickNote: QuickNoteWidget,
  quote: QuoteWidget,
  countdown: CountdownWidget,
};

/** The enabled widgets, in the order chosen in Settings. One or two sit centred; three or more fill a 3-column grid. */
export function HomeWidgets() {
  const widgets = useHomeLayoutStore((s) => s.layout.widgets);
  if (widgets.length === 0) return null;

  return (
    <motion.div
      variants={fadeUp}
      className={cn(
        'mx-auto grid w-full grid-cols-1 gap-3',
        widgets.length === 1 && 'max-w-sm',
        widgets.length === 2 && 'max-w-2xl sm:grid-cols-2',
        widgets.length >= 3 && 'max-w-5xl sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {widgets.map((id) => {
        const Widget = REGISTRY[id];
        return <Widget key={id} />;
      })}
    </motion.div>
  );
}
