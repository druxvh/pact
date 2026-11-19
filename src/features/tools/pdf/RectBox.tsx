import { type ReactNode, type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { type FRect, type Handle, resizeRect } from '@/features/tools/lib/pdf/geometry';
import { cn } from '@/lib/cn';

const HANDLES: Array<{ h: Handle; cls: string; cursor: string }> = [
  { h: 'nw', cls: '-left-1.5 -top-1.5', cursor: 'nwse-resize' },
  { h: 'ne', cls: '-right-1.5 -top-1.5', cursor: 'nesw-resize' },
  { h: 'sw', cls: '-bottom-1.5 -left-1.5', cursor: 'nesw-resize' },
  { h: 'se', cls: '-bottom-1.5 -right-1.5', cursor: 'nwse-resize' },
  { h: 'n', cls: '-top-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { h: 's', cls: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { h: 'w', cls: '-left-1.5 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { h: 'e', cls: '-right-1.5 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

/**
 * A movable, resizable rectangle laid over a page (positioned in %, so it follows the page's size). Drag the body to
 * move, the handles to resize; arrow keys nudge it (Shift = bigger steps, Alt = resize). Its parent must be the
 * positioned page box. `lockAspect` keeps its shape (corners only) — used for signatures.
 */
export function RectBox({
  rect,
  onChange,
  label,
  lockAspect,
  dimOutside,
  selected = true,
  onSelect,
  className,
  children,
}: {
  rect: FRect;
  onChange: (next: FRect) => void;
  label: string;
  /** width/height of the rectangle in page-fraction space; omit for free resizing. */
  lockAspect?: number;
  /** Darken everything outside (crop frames). */
  dimOutside?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; start: FRect; x: number; y: number; w: number; h: number } | null>(null);

  const begin = (handle: Handle) => (e: ReactPointerEvent) => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.();
    const r = parent.getBoundingClientRect();
    drag.current = { handle, start: rect, x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    onChange(resizeRect(d.start, d.handle, (e.clientX - d.x) / d.w, (e.clientY - d.y) / d.h, { aspect: lockAspect, minW: 0.03, minH: 0.02 }));
  };
  const end = () => {
    drag.current = null;
  };

  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.005;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = d[e.key];
    if (!delta) return;
    e.preventDefault();
    onChange(resizeRect(rect, e.altKey ? 'se' : 'move', delta[0], delta[1], { aspect: lockAspect, minW: 0.03, minH: 0.02 }));
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an absolutely positioned frame over a canvas can't be a <fieldset>
    <div
      ref={box}
      role="group"
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a focusable frame so it can be nudged with the arrow keys
      tabIndex={0}
      onKeyDown={key}
      onFocus={onSelect}
      className={cn('absolute touch-none outline-offset-2', selected ? 'z-10' : 'z-0', className)}
      style={{
        left: `${rect.left * 100}%`,
        top: `${rect.top * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
        boxShadow: dimOutside ? '0 0 0 9999px rgb(0 0 0 / 0.5)' : undefined,
      }}
    >
      <div
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className={cn('absolute inset-0 cursor-move border-2', selected ? 'border-brand' : 'border-brand/40 border-dashed')}
      >
        {children}
      </div>
      {selected &&
        HANDLES.filter((h) => !lockAspect || h.h.length === 2).map(({ h, cls, cursor }) => (
          <span
            key={h}
            onPointerDown={begin(h)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className={cn('absolute size-3 rounded-sm border-2 border-brand bg-white', cls)}
            style={{ cursor }}
          />
        ))}
    </div>
  );
}
