import { ArrowLeftRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { IconButton, Input, Segmented, Select } from '@/components/ui';
import { CATEGORIES, CATEGORY_BY_ID, convert, formatUnit } from '@/features/tools/lib/units';
import { CopyButton, Field } from '@/features/tools/ui';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

const DEFAULTS: Record<string, [string, string]> = {
  length: ['km', 'mi'],
  mass: ['kg', 'lb'],
  temperature: ['c', 'f'],
  volume: ['l', 'gal'],
  area: ['m2', 'ft2'],
  speed: ['kmh', 'mph'],
  data: ['gb', 'mib'],
  time: ['h', 'min'],
};

export function ConvertTool() {
  const [categoryId, setCategoryId] = useState('length');
  const [value, setValue] = useState('10');
  const [pairs, setPairs] = useState<Record<string, [string, string]>>(DEFAULTS);

  const category = CATEGORY_BY_ID[categoryId] ?? CATEGORIES[0];
  const [from, to] = pairs[categoryId] ?? DEFAULTS[categoryId] ?? ['', ''];
  const setPair = (f: string, t: string) => setPairs((p) => ({ ...p, [categoryId]: [f, t] }));

  const n = Number.parseFloat(value.replace(',', '.'));
  const valid = Number.isFinite(n);
  const result = valid ? convert(n, categoryId, from, to) : Number.NaN;
  const options = useMemo(() => (category?.units ?? []).map((u) => ({ value: u.id, label: `${u.label} (${u.symbol})` })), [category]);
  const symbol = (id: string) => category?.units.find((u) => u.id === id)?.symbol ?? '';

  if (!category) return null;

  return (
    <div className="space-y-6">
      <div className="no-scrollbar -mx-1 -mt-1 overflow-x-auto px-1 pb-1 pt-1">
        <Segmented aria-label="Category" value={categoryId} onValueChange={setCategoryId} options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} />
      </div>

      <div className="grid items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-3">
          <Field label="Value">
            <Input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="Value to convert"
              aria-invalid={!valid && value !== '' ? true : undefined}
              className="h-10 font-mono text-xl"
            />
          </Field>
          <Field label="From">
            <Select aria-label="From unit" value={from} onValueChange={(v) => setPair(v, to)} options={options} />
          </Field>
        </div>

        <IconButton
          label="Swap units"
          variant="outline"
          size="icon-lg"
          className="mx-auto md:mb-0.5"
          onClick={() => {
            setPair(to, from);
            if (valid) setValue(String(Number(result.toPrecision(10))));
          }}
        >
          <ArrowLeftRight />
        </IconButton>

        <div className="space-y-3">
          <Field label="Result">
            <div className="flex h-10 items-center justify-between gap-2 rounded-md border bg-brand-soft px-3">
              <motion.span
                key={`${categoryId}-${to}-${formatUnit(result)}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="tabular truncate font-mono text-xl text-brand-text"
              >
                {valid ? formatUnit(result) : '—'}
              </motion.span>
              <CopyButton text={valid ? String(Number(result.toPrecision(12))) : ''} label="Copy result" size="icon-xs" />
            </div>
          </Field>
          <Field label="To">
            <Select aria-label="To unit" value={to} onValueChange={(v) => setPair(from, v)} options={options} />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">{valid ? `${formatUnit(n)} ${symbol(from)} equals…` : 'Enter a number'}</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {category.units
            .filter((u) => u.id !== from)
            .map((u, i) => (
              <motion.button
                key={u.id}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring.soft, delay: i * 0.02 }}
                onClick={() => setPair(from, u.id)}
                className={cn(
                  'flex items-baseline justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent',
                  u.id === to && 'border-brand/40 bg-brand-soft',
                )}
              >
                <span className="text-xs text-muted-foreground">{u.label}</span>
                <span className="tabular truncate font-mono text-[13px]">
                  {valid ? formatUnit(convert(n, categoryId, from, u.id)) : '—'} <span className="text-subtle-foreground">{u.symbol}</span>
                </span>
              </motion.button>
            ))}
        </div>
      </div>
    </div>
  );
}

export default ConvertTool;
