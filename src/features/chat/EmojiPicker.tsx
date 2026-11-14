import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EMOJI_CATEGORIES, searchEmoji } from '@/features/chat/emoji-data';
import { useChatStore } from '@/features/chat/store';
import { cn } from '@/lib/cn';

type Props = { onPick: (emoji: string) => void; className?: string };

/** Searchable emoji grid with categories and recents. */
function EmojiGrid({ emojis, label, onPick }: { emojis: readonly string[]; label?: string; onPick: (emoji: string) => void }) {
  return (
    <div>
      {label && <p className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">{label}</p>}
      <div className="grid grid-cols-8 gap-0.5">
        {emojis.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className="grid size-8 place-items-center rounded-lg text-xl transition-[transform,background-color] duration-100 hover:scale-125 hover:bg-accent active:scale-95"
            aria-label={e}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EmojiPicker({ onPick, className }: Props) {
  const recent = useChatStore((s) => s.recentEmoji);
  const pushRecent = useChatStore((s) => s.pushRecentEmoji);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('smileys');

  const results = useMemo(() => searchEmoji(query), [query]);
  const cat = EMOJI_CATEGORIES.find((c) => c.id === category) ?? EMOJI_CATEGORIES[0];
  const searching = query.trim() !== '';

  const pick = (e: string) => {
    pushRecent(e);
    onPick(e);
  };

  return (
    <div className={cn('w-[19rem]', className)}>
      <div className="relative p-2 pb-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-[40%] text-muted-foreground" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the picker opens on request and search should be ready to type
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji…"
          aria-label="Search emoji"
          className="h-8 w-full rounded-lg border bg-muted/40 pl-8 pr-2 text-[13px] outline-none placeholder:text-subtle-foreground focus:border-ring"
        />
      </div>

      {!searching && (
        <div className="flex gap-0.5 px-2 pb-1" role="tablist" aria-label="Emoji categories">
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === category}
              aria-label={c.label}
              title={c.label}
              onClick={() => setCategory(c.id)}
              className={cn(
                'grid size-8 flex-1 place-items-center rounded-lg text-base transition-colors',
                c.id === category ? 'bg-brand-soft' : 'opacity-60 hover:bg-accent hover:opacity-100',
              )}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}

      <div className="h-56 overflow-y-auto px-2 pb-2">
        {searching ? (
          results.length ? (
            <EmojiGrid emojis={results} onPick={pick} />
          ) : (
            <p className="py-10 text-center text-[13px] text-muted-foreground">No emoji for “{query}”</p>
          )
        ) : (
          <>
            {recent.length > 0 && <EmojiGrid emojis={recent} label="Recent" onPick={pick} />}
            {cat && <EmojiGrid emojis={cat.emojis.map(([e]) => e)} label={cat.label} onPick={pick} />}
          </>
        )}
      </div>
    </div>
  );
}
