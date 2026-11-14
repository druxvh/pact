import { Slider as SL } from '@base-ui/react/slider';
import { cn } from '@/lib/cn';

type Props = {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  'aria-label'?: string;
};

export function Slider({ value, onValueChange, min = 0, max = 100, step = 1, className, ...aria }: Props) {
  return (
    <SL.Root
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onValueChange(Array.isArray(v) ? (v[0] ?? min) : v)}
      className={cn('w-full', className)}
    >
      <SL.Control className="flex h-5 w-full touch-none select-none items-center">
        <SL.Track className="relative h-1.5 w-full rounded-full bg-muted">
          <SL.Indicator className="rounded-full bg-brand" />
          <SL.Thumb
            aria-label={aria['aria-label']}
            className="size-4 rounded-full border-2 border-brand bg-background shadow-md outline-offset-2 transition-transform duration-150 ease-out-quart data-[dragging]:scale-125"
          />
        </SL.Track>
      </SL.Control>
    </SL.Root>
  );
}
