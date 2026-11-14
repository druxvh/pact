import { RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { IconButton, Slider, Switch } from '@/components/ui';
import { entropyBits, generatePassword, type PasswordOptions, randomId, SETS, type SetKey, strengthLabel } from '@/features/tools/lib/password';
import { CopyButton, Field, ResultRow } from '@/features/tools/ui';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

const SET_LABEL: Record<SetKey, string> = { lower: 'Lowercase (a–z)', upper: 'Uppercase (A–Z)', digits: 'Numbers (0–9)', symbols: 'Symbols (!@#…)' };
const BAR: Record<string, string> = { destructive: 'bg-destructive', warning: 'bg-warning', success: 'bg-success', brand: 'bg-brand' };

/** Colour-code characters so digits and symbols stand out (and "O" vs "0" is unmistakable). */
function Colored({ value }: { value: string }) {
  return (
    <>
      {Array.from(value).map((ch, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: characters are positional
          key={i}
          className={cn(/\d/.test(ch) ? 'text-brand-text' : /[^\p{L}\p{N}]/u.test(ch) ? 'text-warning-text' : 'text-foreground')}
        >
          {ch}
        </span>
      ))}
    </>
  );
}

export function PasswordTool() {
  const [opts, setOpts] = useState<PasswordOptions>({
    length: 20,
    sets: { lower: true, upper: true, digits: true, symbols: true },
    excludeAmbiguous: false,
  });
  const [password, setPassword] = useState('');
  const [spin, setSpin] = useState(0);
  const [ids, setIds] = useState(() => ({ uuid: crypto.randomUUID(), short: randomId(), hex: '' }));

  const regenerate = useCallback(() => setPassword(generatePassword(opts)), [opts]);
  useEffect(regenerate, [regenerate]);

  const enabledCount = Object.values(opts.sets).filter(Boolean).length;
  const bits = entropyBits(opts);
  const strength = strengthLabel(bits);

  const newIds = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    setIds({ uuid: crypto.randomUUID(), short: randomId(), hex: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') });
  };
  useEffect(newIds, []);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <div className="relative rounded-2xl border bg-muted/30 p-5 pr-24">
          <p className="min-h-[3.25rem] break-all font-mono text-xl leading-relaxed tracking-wide sm:text-2xl" aria-live="polite">
            <Colored value={password} />
          </p>
          <div className="absolute right-3 top-3 flex items-center gap-1">
            <IconButton
              label="Generate a new password"
              size="icon-sm"
              onClick={() => {
                regenerate();
                setSpin((n) => n + 1);
              }}
            >
              <motion.span animate={{ rotate: spin * 360 }} transition={spring.soft} className="grid place-items-center">
                <RefreshCw />
              </motion.span>
            </IconButton>
            <CopyButton text={password} label="Copy password" />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between text-[13px]">
            <span className="font-medium">{strength.label}</span>
            <span className="tabular text-xs text-muted-foreground">{Math.round(bits)} bits of entropy</span>
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: <meter> cannot host the animated fill, so the ARIA meter role carries the semantics */}
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuenow={Math.round(bits)}
            aria-valuemin={0}
            aria-valuemax={128}
            aria-label="Password strength"
          >
            <motion.div
              className={cn('h-full rounded-full', BAR[strength.tone])}
              initial={false}
              animate={{ width: `${strength.pct}%` }}
              transition={spring.soft}
            />
          </div>
        </div>

        <Field label={`Length: ${opts.length}`}>
          <Slider aria-label="Password length" value={opts.length} min={8} max={64} onValueChange={(length) => setOpts((o) => ({ ...o, length }))} />
        </Field>

        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(SETS) as SetKey[]).map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-[13px]">
              {SET_LABEL[k]}
              <Switch
                aria-label={SET_LABEL[k]}
                checked={opts.sets[k]}
                // never allow turning off the last remaining set
                disabled={opts.sets[k] && enabledCount === 1}
                onCheckedChange={(v) => setOpts((o) => ({ ...o, sets: { ...o.sets, [k]: v } }))}
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-[13px] sm:col-span-2">
            Avoid look-alike characters (I, l, 1, O, 0)
            <Switch
              aria-label="Avoid look-alike characters"
              checked={opts.excludeAmbiguous}
              onCheckedChange={(v) => setOpts((o) => ({ ...o, excludeAmbiguous: v }))}
            />
          </label>
        </div>
      </div>

      <aside className="space-y-3 rounded-2xl border bg-card/60 p-4" aria-label="Random identifiers">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Identifiers</h3>
          <IconButton label="Regenerate identifiers" size="icon-sm" onClick={newIds}>
            <RefreshCw />
          </IconButton>
        </div>
        <ResultRow label="UUID" value={ids.uuid} />
        <ResultRow label="Short" value={ids.short} />
        <ResultRow label="Token" value={ids.hex} />
        <p className="pt-1 text-[11px] leading-relaxed text-subtle-foreground">
          Generated on this device with your browser’s cryptographically secure random source. Nothing is stored or sent anywhere.
        </p>
      </aside>
    </div>
  );
}

export default PasswordTool;
