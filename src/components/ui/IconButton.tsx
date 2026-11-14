import { Button, type ButtonProps } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';

type Props = Omit<ButtonProps, 'aria-label'> & {
  /** Accessible name AND tooltip text. */
  label: string;
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  tooltip?: boolean;
};

export function IconButton({
  label,
  shortcut,
  side = 'top',
  tooltip = true,
  size = 'icon',
  variant = 'ghost',
  ...props
}: Props) {
  const button = <Button aria-label={label} size={size} variant={variant} {...props} />;
  return tooltip ? (
    <Tooltip content={label} shortcut={shortcut} side={side}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
