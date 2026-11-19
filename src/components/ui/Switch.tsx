import { Switch as S } from '@base-ui/react/switch';
import { cn } from '@/lib/cn';

export function Switch({ className, ...props }: Omit<React.ComponentProps<typeof S.Root>, 'className'> & { className?: string }) {
  return (
    <S.Root
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 outline-offset-2 transition-colors duration-200',
        'data-[checked]:bg-brand data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out-expo data-[checked]:translate-x-4" />
    </S.Root>
  );
}
