import { Quote as QuoteIcon } from 'lucide-react';
import { quoteOfTheDay } from '@/features/home/widgets/quotes';
import { WidgetCard } from '@/features/home/widgets/WidgetCard';

/** One line to think about, the same all day and different tomorrow. Bundled — no network. */
export function QuoteWidget() {
  const q = quoteOfTheDay();
  return (
    <WidgetCard icon={QuoteIcon} title="Quote of the day">
      <figure className="flex flex-1 flex-col justify-between gap-3">
        <blockquote className="text-[15px] leading-relaxed">{q.text}</blockquote>
        <figcaption className="text-[13px] text-muted-foreground">— {q.by}</figcaption>
      </figure>
    </WidgetCard>
  );
}
