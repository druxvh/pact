import { Dices, Shuffle, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button, Segmented, Textarea } from '@/components/ui';
import { randomInt } from '@/features/tools/lib/password';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

type Mode = 'dice' | 'coin' | 'picker';
const SIDES = [4, 6, 8, 10, 12, 20] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────────── Dice ───────────── */
function Dice() {
  const [sides, setSides] = useState<(typeof SIDES)[number]>(6);
  const [count, setCount] = useState(2);
  const [values, setValues] = useState<number[]>([]);
  const [rolling, setRolling] = useState(false);
  const [rolls, setRolls] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode mounts, unmounts and re-mounts in development
    return () => {
      alive.current = false;
    };
  }, []);

  const roll = async () => {
    if (rolling) return;
    setRolling(true);
    setRolls((r) => r + 1);
    for (let i = 0; i < 9; i++) {
      if (!alive.current) return;
      setValues(Array.from({ length: count }, () => randomInt(sides) + 1));
      await sleep(55 + i * 14); // decelerate like a real tumble
    }
    setValues(Array.from({ length: count }, () => randomInt(sides) + 1));
    setRolling(false);
  };

  const sum = values.reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Segmented
          aria-label="Die type"
          value={String(sides)}
          onValueChange={(v) => {
            setSides(Number(v) as (typeof SIDES)[number]);
            setValues([]);
          }}
          options={SIDES.map((s) => ({ value: String(s), label: `d${s}` }))}
        />
        <Segmented
          aria-label="Number of dice"
          size="sm"
          value={String(count)}
          onValueChange={(v) => {
            setCount(Number(v));
            setValues([]);
          }}
          options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n}×` }))}
        />
      </div>

      <div className="flex min-h-36 flex-wrap items-center justify-center gap-4 rounded-2xl border bg-muted/30 p-6">
        {values.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Roll {count} × d{sides}
          </p>
        ) : (
          values.map((v, i) => (
            <motion.div
              // biome-ignore lint/suspicious/noArrayIndexKey: dice are positional
              key={i}
              animate={rolling ? { rotate: [0, -14, 12, -8, 0], y: [0, -10, 0] } : { rotate: 0, y: 0, scale: 1 }}
              transition={rolling ? { duration: 0.28, repeat: Number.POSITIVE_INFINITY } : spring.bouncy}
              className="grid size-20 place-items-center rounded-2xl border bg-card text-3xl font-semibold shadow-md tabular"
            >
              {v}
            </motion.div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="primary" size="lg" onClick={() => void roll()} disabled={rolling}>
          <Dices className={cn(rolling && 'animate-spin')} /> {rolling ? 'Rolling…' : rolls ? 'Roll again' : 'Roll'}
        </Button>
        {values.length > 1 && !rolling && (
          <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-muted-foreground">
            Total <span className="tabular text-2xl font-semibold text-foreground">{sum}</span>
          </motion.p>
        )}
      </div>
    </div>
  );
}

/* ───────────── Coin ───────────── */
function Coin() {
  const [rotation, setRotation] = useState(0);
  const [side, setSide] = useState<'heads' | 'tails' | null>(null);
  const [tally, setTally] = useState({ heads: 0, tails: 0 });
  const [flipping, setFlipping] = useState(false);

  const flip = async () => {
    if (flipping) return;
    setFlipping(true);
    const result: 'heads' | 'tails' = randomInt(2) === 0 ? 'heads' : 'tails';
    // whole spins (visual drama) + land on the right face (0° = heads, 180° = tails)
    setRotation((r) => Math.ceil(r / 360) * 360 + 1440 + (result === 'tails' ? 180 : 0));
    await sleep(1350);
    setSide(result);
    setTally((t) => ({ ...t, [result]: t[result] + 1 }));
    setFlipping(false);
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="grid h-52 place-items-center [perspective:900px]">
        <motion.div
          animate={{ rotateY: rotation, y: flipping ? [0, -70, 0] : 0 }}
          transition={{ rotateY: { duration: 1.3, ease: [0.22, 1, 0.36, 1] }, y: { duration: 1.3, times: [0, 0.4, 1], ease: 'easeInOut' } }}
          className="relative size-36 [transform-style:preserve-3d]"
        >
          {(['heads', 'tails'] as const).map((f) => (
            <div
              key={f}
              className={cn(
                'absolute inset-0 grid place-items-center rounded-full border-4 border-warning/70 text-5xl font-bold shadow-lg [backface-visibility:hidden]',
                f === 'heads'
                  ? 'bg-gradient-to-br from-warning via-brand to-warning text-brand-foreground'
                  : 'bg-gradient-to-br from-muted-foreground/40 via-secondary to-muted-foreground/40 text-foreground [transform:rotateY(180deg)]',
              )}
            >
              {f === 'heads' ? 'H' : 'T'}
            </div>
          ))}
        </motion.div>
      </div>

      <div className="h-8 text-center" aria-live="polite">
        <AnimatePresence mode="wait">
          {side && !flipping && (
            <motion.p
              key={side + tally.heads + tally.tails}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={spring.bouncy}
              className="text-xl font-semibold capitalize"
            >
              {side}!
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <Button variant="primary" size="lg" onClick={() => void flip()} disabled={flipping}>
        <Sparkles /> {flipping ? 'Flipping…' : 'Flip the coin'}
      </Button>
      <p className="tabular text-xs text-muted-foreground">
        Heads {tally.heads} · Tails {tally.tails}
      </p>
    </div>
  );
}

/* ───────────── Picker ───────────── */
function Picker() {
  const [raw, setRaw] = useState('Pizza\nSushi\nTacos\nCurry');
  const [highlight, setHighlight] = useState<number | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode mounts, unmounts and re-mounts in development
    return () => {
      alive.current = false;
    };
  }, []);

  const options = raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const choose = async () => {
    if (busy || options.length < 2) return;
    setBusy(true);
    setWinner(null);
    const n = options.length;
    const target = randomInt(n);
    // Cycle through the options, decelerating, and finish exactly on `target`:
    // start somewhere, go a few full laps, then add the remainder needed to land on it.
    const start = randomInt(n);
    const total = (3 + randomInt(2)) * n + ((target - start + n) % n);
    for (let step = 1; step <= total; step++) {
      if (!alive.current) return;
      setHighlight((start + step) % n);
      const t = step / total;
      await sleep(45 + t * t * 260);
    }
    setHighlight(null);
    setWinner(target);
    setBusy(false);
  };

  const shuffle = () => {
    const a = [...options];
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j] as string, a[i] as string];
    }
    setRaw(a.join('\n'));
    setWinner(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor="picker-options" className="text-xs font-medium text-muted-foreground">
          Options — one per line
        </label>
        <Textarea
          id="picker-options"
          rows={9}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setWinner(null);
          }}
          className="min-h-52"
        />
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void choose()} disabled={busy || options.length < 2}>
            <Sparkles /> {busy ? 'Picking…' : 'Pick one'}
          </Button>
          <Button variant="outline" onClick={shuffle} disabled={options.length < 2 || busy}>
            <Shuffle /> Shuffle order
          </Button>
        </div>
        {options.length < 2 && <p className="text-xs text-muted-foreground">Add at least two options.</p>}
      </div>

      <div className="flex min-h-52 flex-wrap content-start gap-2 rounded-2xl border bg-muted/30 p-4" aria-live="polite">
        {options.map((o, i) => (
          <motion.span
            // biome-ignore lint/suspicious/noArrayIndexKey: user can repeat names
            key={`${o}-${i}`}
            layout
            animate={{ scale: winner === i ? 1.12 : highlight === i ? 1.06 : 1 }}
            transition={spring.bouncy}
            className={cn(
              'rounded-xl border px-3 py-1.5 text-sm transition-colors duration-100',
              winner === i
                ? 'border-brand bg-brand font-semibold text-brand-foreground shadow-brand'
                : highlight === i
                  ? 'border-brand/50 bg-brand-soft text-brand-text'
                  : 'bg-card',
            )}
          >
            {o}
          </motion.span>
        ))}
        {winner !== null && options[winner] && (
          <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 w-full text-center text-sm text-muted-foreground">
            The winner is <span className="font-semibold text-foreground">{options[winner]}</span> 🎉
          </motion.p>
        )}
      </div>
    </div>
  );
}

export function RandomTool() {
  const [mode, setMode] = useState<Mode>('dice');
  return (
    <div className="space-y-6">
      <Segmented<Mode>
        aria-label="Randomizer"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: 'dice', label: 'Dice' },
          { value: 'coin', label: 'Coin' },
          { value: 'picker', label: 'Picker' },
        ]}
      />
      {mode === 'dice' && <Dice />}
      {mode === 'coin' && <Coin />}
      {mode === 'picker' && <Picker />}
    </div>
  );
}

export default RandomTool;
