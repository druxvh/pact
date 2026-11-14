import { Eraser, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton, Textarea } from '@/components/ui';
import { CASES, type CaseKind, LINES, type LineKind, reverseText, textStats } from '@/features/tools/lib/text';
import { CopyButton } from '@/features/tools/ui';
import { formatMinutes } from '@/lib/format';

const CASE_BUTTONS: Array<[CaseKind, string]> = [
  ['upper', 'UPPER'],
  ['lower', 'lower'],
  ['title', 'Title Case'],
  ['sentence', 'Sentence case'],
  ['camel', 'camelCase'],
  ['pascal', 'PascalCase'],
  ['snake', 'snake_case'],
  ['kebab', 'kebab-case'],
  ['constant', 'CONSTANT_CASE'],
  ['slug', 'slug'],
];

const LINE_BUTTONS: Array<[LineKind, string]> = [
  ['sort', 'Sort A→Z'],
  ['reverse', 'Reverse lines'],
  ['unique', 'Remove duplicates'],
  ['dropEmpty', 'Drop empty lines'],
  ['trim', 'Trim lines'],
];

export function TextTool() {
  const [text, setText] = useState('');
  // A small undo stack: transforms are destructive, so keep what you had.
  const [past, setPast] = useState<string[]>([]);

  const apply = (fn: (s: string) => string) => {
    const next = fn(text);
    if (next === text) return;
    setPast((p) => [text, ...p].slice(0, 20));
    setText(next);
  };
  const undo = () => {
    const [prev, ...rest] = past;
    if (prev === undefined) return;
    setPast(rest);
    setText(prev);
  };

  const s = textStats(text);
  const stats: Array<[string, string]> = [
    ['Characters', s.chars.toLocaleString()],
    ['Words', s.words.toLocaleString()],
    ['Lines', s.lines.toLocaleString()],
    ['Sentences', s.sentences.toLocaleString()],
    ['Reading time', s.words ? formatMinutes(Math.max(1, Math.round(s.readingMinutes))) : '—'],
  ];

  return (
    <div className="space-y-5">
      <div className="relative">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          autoFocus
          placeholder="Paste or type text here…"
          aria-label="Text"
          className="min-h-48 pr-24 font-mono text-[13px]"
        />
        <div className="absolute right-2 top-2 flex items-center gap-0.5">
          <IconButton label="Undo last change" size="icon-sm" onClick={undo} disabled={past.length === 0}>
            <Undo2 />
          </IconButton>
          <IconButton
            label="Clear"
            size="icon-sm"
            onClick={() => {
              if (text) setPast((p) => [text, ...p].slice(0, 20));
              setText('');
            }}
            disabled={!text}
          >
            <Eraser />
          </IconButton>
          <CopyButton text={text} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-muted/30 px-3 py-2">
            <dt className="text-[11px] text-subtle-foreground">{label}</dt>
            <dd className="tabular text-base font-semibold tracking-tight">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-label="Change case">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Case</h3>
        <div className="flex flex-wrap gap-1.5">
          {CASE_BUTTONS.map(([k, label]) => (
            <Button key={k} variant="outline" size="sm" disabled={!text} onClick={() => apply(CASES[k])}>
              {label}
            </Button>
          ))}
        </div>
      </section>

      <section aria-label="Lines and cleanup">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Lines &amp; cleanup</h3>
        <div className="flex flex-wrap gap-1.5">
          {LINE_BUTTONS.map(([k, label]) => (
            <Button key={k} variant="outline" size="sm" disabled={!text} onClick={() => apply(LINES[k])}>
              {label}
            </Button>
          ))}
          <Button variant="outline" size="sm" disabled={!text} onClick={() => apply(reverseText)}>
            Reverse text
          </Button>
          <Button variant="outline" size="sm" disabled={!text} onClick={() => apply((t) => t.replace(/[ \t]+/g, ' ').trim())}>
            Collapse spaces
          </Button>
        </div>
      </section>
    </div>
  );
}

export default TextTool;
