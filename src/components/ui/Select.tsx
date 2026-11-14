import { Select as S } from '@base-ui/react/select';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export type SelectOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  'aria-label'?: string;
};

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = 'md',
  ...aria
}: Props<T>) {
  return (
    <S.Root
      value={value}
      onValueChange={(v) => {
        if (v != null) onValueChange(v as T);
      }}
      items={options as ReadonlyArray<{ value: T; label: string }>}
    >
      <S.Trigger
        aria-label={aria['aria-label']}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded-md border border-input bg-card/50 text-left text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150',
          'hover:border-foreground/25 data-[popup-open]:border-ring data-[popup-open]:ring-4 data-[popup-open]:ring-ring/15 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15',
          size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3',
          className,
        )}
      >
        <S.Value placeholder={placeholder} className="truncate" />
        <S.Icon className="text-muted-foreground">
          <ChevronsUpDown className="size-3.5" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Positioner sideOffset={6} alignItemWithTrigger={false} collisionPadding={12} className="z-[80]">
          <S.Popup className="popup-motion max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-pop outline-none">
            <S.List>
              {options.map((o) => (
                <S.Item
                  key={o.value}
                  value={o.value}
                  className="grid cursor-pointer select-none grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-accent"
                >
                  <S.ItemText>{o.label}</S.ItemText>
                  <S.ItemIndicator>
                    <Check className="size-3.5 text-brand-text" />
                  </S.ItemIndicator>
                </S.Item>
              ))}
            </S.List>
          </S.Popup>
        </S.Positioner>
      </S.Portal>
    </S.Root>
  );
}
