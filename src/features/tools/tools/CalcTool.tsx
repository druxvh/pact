import { Delete, History } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { Button, Segmented } from '@/components/ui';
import { type AngleMode, evaluate, formatResult, plainResult } from '@/features/tools/lib/calc';
import { CopyButton } from '@/features/tools/ui';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

type Key = { label: string; insert?: string; action?: 'clear' | 'back' | 'equals'; tone?: 'op' | 'accent' | 'fn' };

const PAD: Key[][] = [
  [
    { label: 'C', action: 'clear', tone: 'fn' },
    { label: '( )', insert: '(', tone: 'fn' },
    { label: '%', insert: '%', tone: 'fn' },
    { label: '÷', insert: '÷', tone: 'op' },
  ],
  [
    { label: '7', insert: '7' },
    { label: '8', insert: '8' },
    { label: '9', insert: '9' },
    { label: '×', insert: '×', tone: 'op' },
  ],
  [
    { label: '4', insert: '4' },
    { label: '5', insert: '5' },
    { label: '6', insert: '6' },
    { label: '−', insert: '−', tone: 'op' },
  ],
  [
    { label: '1', insert: '1' },
    { label: '2', insert: '2' },
    { label: '3', insert: '3' },
    { label: '+', insert: '+', tone: 'op' },
  ],
  [
    { label: '0', insert: '0' },
    { label: '.', insert: '.' },
    { label: '⌫', action: 'back', tone: 'fn' },
    { label: '=', action: 'equals', tone: 'accent' },
  ],
];

const FUNCTIONS = ['sin(', 'cos(', 'tan(', '√(', 'ln(', 'log(', 'π', 'e', '^', '!', 'abs(', 'round('];

export function CalcTool() {
  const [expr, setExpr] = useState('');
  const [angle, setAngle] = useState<AngleMode>('deg');
  const [history, setHistory] = useState<Array<{ expr: string; result: string; plain: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const result = useMemo(() => evaluate(expr, angle), [expr, angle]);

  const insert = (text: string) => {
    const el = inputRef.current;
    const s = el?.selectionStart ?? expr.length;
    const e = el?.selectionEnd ?? expr.length;
    // "( )" smart-paren: open if balanced, close otherwise
    let t = text;
    if (text === '(') {
      const before = expr.slice(0, s);
      const open = (before.match(/\(/g) ?? []).length;
      const close = (before.match(/\)/g) ?? []).length;
      t = open > close && /[\d)πe]$/.test(before) ? ')' : '(';
    }
    setExpr(expr.slice(0, s) + t + expr.slice(e));
    requestAnimationFrame(() => {
      el?.focus();
      const caret = s + t.length;
      el?.setSelectionRange(caret, caret);
    });
  };

  const commit = () => {
    if (!result.ok) return;
    const plain = plainResult(result.value);
    setHistory((h) => [{ expr, result: formatResult(result.value), plain }, ...h].slice(0, 12));
    setExpr(plain);
  };

  const press = (k: Key) => {
    if (k.action === 'clear') setExpr('');
    else if (k.action === 'back') {
      const el = inputRef.current;
      const s = el?.selectionStart ?? expr.length;
      const e = el?.selectionEnd ?? expr.length;
      if (s !== e) setExpr(expr.slice(0, s) + expr.slice(e));
      else if (s > 0) setExpr(expr.slice(0, s - 1) + expr.slice(s));
      requestAnimationFrame(() => {
        el?.focus();
        const c = s !== e ? s : Math.max(0, s - 1);
        el?.setSelectionRange(c, c);
      });
    } else if (k.action === 'equals') commit();
    else if (k.insert) insert(k.insert);
  };

  const live = result.ok ? formatResult(result.value) : '';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="space-y-4">
        <div className="rounded-2xl border bg-muted/30 p-4">
          <input
            ref={inputRef}
            // biome-ignore lint/a11y/noAutofocus: the calculator is the page; typing should start immediately
            autoFocus
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setExpr('');
              }
            }}
            inputMode="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="Type an expression, e.g. 2(3+4)^2 / 7"
            aria-label="Expression"
            className="w-full bg-transparent text-right font-mono text-2xl outline-none placeholder:text-base placeholder:text-subtle-foreground sm:text-3xl"
          />
          <div className="mt-2 flex h-9 items-center justify-between gap-3">
            <Segmented<AngleMode>
              size="sm"
              aria-label="Angle unit"
              value={angle}
              onValueChange={setAngle}
              options={[
                { value: 'deg', label: 'DEG' },
                { value: 'rad', label: 'RAD' },
              ]}
            />
            <div className="flex min-w-0 items-center gap-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={live || (result.ok ? 'ok' : result.error)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className={cn('tabular truncate text-right font-mono text-xl', result.ok ? 'text-brand-text' : 'text-sm text-subtle-foreground')}
                  aria-live="polite"
                >
                  {result.ok ? `= ${live}` : result.error}
                </motion.p>
              </AnimatePresence>
              {result.ok && <CopyButton text={plainResult(result.value)} label="Copy result" size="icon-xs" />}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FUNCTIONS.map((f) => (
            <Button key={f} variant="outline" size="xs" className="font-mono" onClick={() => insert(f)}>
              {f}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-2">
          {PAD.flat().map((k) => (
            <motion.button
              key={k.label}
              type="button"
              whileTap={{ scale: 0.92 }}
              transition={spring.snappy}
              onClick={() => press(k)}
              aria-label={k.action === 'back' ? 'Backspace' : k.action === 'equals' ? 'Equals' : k.action === 'clear' ? 'Clear' : k.label}
              className={cn(
                'h-12 rounded-xl border text-lg font-medium outline-offset-2 transition-colors duration-150 sm:h-14',
                k.tone === 'accent'
                  ? 'border-transparent bg-brand text-brand-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.28)] hover:brightness-110'
                  : k.tone === 'op'
                    ? 'bg-brand-soft text-brand-text hover:bg-brand/25'
                    : k.tone === 'fn'
                      ? 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                      : 'bg-card hover:bg-accent',
              )}
            >
              {k.action === 'back' ? <Delete className="mx-auto size-5" /> : k.label}
            </motion.button>
          ))}
        </div>
      </div>

      <aside aria-label="History" className="min-h-40 rounded-2xl border bg-card/60 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <History className="size-3.5" /> History
          </h3>
          {history.length > 0 && (
            <button type="button" onClick={() => setHistory([])} className="text-[11px] text-muted-foreground hover:text-foreground">
              Clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-subtle-foreground">Press Enter to save a calculation</p>
        ) : (
          <ul className="space-y-1">
            <AnimatePresence initial={false}>
              {history.map((h, i) => (
                <motion.li
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered log; newest first
                  key={`${h.expr}-${i}`}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={spring.soft}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setExpr(h.expr);
                      inputRef.current?.focus();
                    }}
                    className="w-full rounded-lg px-2 py-1.5 text-right transition-colors hover:bg-accent"
                  >
                    <span className="block truncate font-mono text-xs text-muted-foreground">{h.expr}</span>
                    <span className="block truncate font-mono text-sm">= {h.result}</span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </aside>
    </div>
  );
}

export default CalcTool;
