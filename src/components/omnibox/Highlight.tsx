import { toRuns } from '@/lib/fuzzy';

/** `text` with the matched characters emphasised (positions come from the fuzzy matcher). */
export function Highlight({ text, indices }: { text: string; indices?: readonly number[] }) {
  if (!indices?.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const [from, to] of toRuns(indices)) {
    if (from >= text.length) break;
    if (from > at) out.push(text.slice(at, from));
    out.push(
      <mark key={from} className="bg-transparent font-semibold text-brand-text">
        {text.slice(from, to)}
      </mark>,
    );
    at = to;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
