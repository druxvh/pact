import { useEffect, useRef, useState } from 'react';
import { Input, Skeleton, Spinner } from '@/components/ui';
import { describeError, toCommunityError } from './mapping';
import type { Gif } from './types';
import { getCommunityApi } from './useCommunityStore';

const SEARCH_DELAY_MS = 350;

/** Search (or browse trending) GIFs and pick one. The GIF is posted as a link to the provider's copy, not re-hosted. */
export function GifPicker({ onPick }: { onPick: (gif: Gif) => void }) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unavailable'>('loading');
  const [message, setMessage] = useState('');
  const [more, setMore] = useState(false);
  const latest = useRef(0); // ignore answers to a search that has since been replaced

  useEffect(() => {
    const id = ++latest.current;
    setState('loading');
    const t = window.setTimeout(
      () => {
        getCommunityApi()
          .searchGifs(query)
          .then((page) => {
            if (id !== latest.current) return;
            setGifs(page.gifs);
            setNext(page.next);
            setState('ready');
          })
          .catch((err) => {
            if (id !== latest.current) return;
            setState(toCommunityError(err).code === 'not_configured' ? 'unavailable' : 'error');
            setMessage(describeError(err));
          });
      },
      query ? SEARCH_DELAY_MS : 0,
    );
    return () => window.clearTimeout(t);
  }, [query]);

  const loadMore = async () => {
    if (!next || more) return;
    const id = latest.current;
    setMore(true);
    try {
      const page = await getCommunityApi().searchGifs(query, { next });
      if (id !== latest.current) return;
      setGifs((g) => [...g, ...page.gifs.filter((x) => !g.some((y) => y.id === x.id))]);
      setNext(page.next);
    } catch (err) {
      setMessage(describeError(err));
      setState('error');
    } finally {
      setMore(false);
    }
  };

  return (
    <div className="flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search GIFs"
        aria-label="Search GIFs"
        maxLength={80}
        type="search"
      />

      <div className="h-72 overflow-y-auto rounded-lg" aria-busy={state === 'loading'}>
        {state === 'unavailable' && <p className="p-3 text-sm text-muted-foreground">{message}</p>}
        {state === 'error' && (
          <p className="p-3 text-sm text-muted-foreground" role="alert">
            {message}
          </p>
        )}
        {state === 'loading' && (
          <div className="columns-2 gap-2" role="status" aria-label="Loading GIFs">
            {[88, 56, 72, 104, 60, 80].map((h) => (
              <Skeleton key={h} className="mb-2 w-full break-inside-avoid" style={{ height: h }} />
            ))}
          </div>
        )}
        {state === 'ready' && gifs.length === 0 && <p className="p-3 text-sm text-muted-foreground">No GIFs for “{query}”. Try another word.</p>}
        {state === 'ready' && gifs.length > 0 && (
          <>
            <ul className="columns-2 gap-2" aria-label="GIF results">
              {gifs.map((g) => (
                <li key={g.id} className="mb-2 break-inside-avoid">
                  <button
                    type="button"
                    onClick={() => onPick(g)}
                    className="block w-full overflow-hidden rounded-lg bg-muted outline-offset-2 transition-transform hover:scale-[1.02] focus-visible:scale-[1.02]"
                    aria-label={g.title || 'GIF'}
                  >
                    <img src={g.preview} alt="" loading="lazy" referrerPolicy="no-referrer" width={g.width} height={g.height} className="h-auto w-full" />
                  </button>
                </li>
              ))}
            </ul>
            {next && (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="mx-auto mb-1 flex h-8 items-center gap-2 rounded-md px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {more ? <Spinner /> : null} Load more
              </button>
            )}
          </>
        )}
      </div>
      <p className="text-center text-[10px] uppercase tracking-wider text-subtle-foreground">{query ? 'Results' : 'Trending'} · Powered by KLIPY</p>
    </div>
  );
}
