import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runOmnibox } from '@/lib/omnibox/engine';
import { emptyUsage } from '@/lib/omnibox/frecency';
import { coreProviders, scopeProvider, submitText } from '@/lib/omnibox/providers';
import type { OmniCtx } from '@/lib/omnibox/types';

const ext = vi.hoisted(() => ({ openUrl: vi.fn(), webSearch: vi.fn(async () => {}) }));
const clip = vi.hoisted(() => ({ copyText: vi.fn(async () => true) }));
vi.mock('@/lib/ext', () => ext);
vi.mock('@/lib/clipboard', () => clip);

const NOW = new Date(2026, 10, 17, 9, 30);
const ctx = (over: Partial<OmniCtx> = {}) =>
  ({ surface: 'home', now: NOW, locale: 'en-US', signedIn: false, refresh: vi.fn(), scope: null, pinned: [], ...over }) as OmniCtx;
const view = (q: string, c: OmniCtx, deps = {}) => runOmnibox(q, c, c.scope ? [scopeProvider(deps)] : coreProviders(deps), emptyUsage());
const ids = (q: string, c = ctx()) => view(q, c).results.map((r) => r.id);

beforeEach(() => vi.clearAllMocks());

describe('answers', () => {
  it('puts the answer card first and copies the value without a toast', async () => {
    const v = view('12*(3+4)/2', ctx());
    const card = v.results[0];
    expect(card).toMatchObject({ id: 'answer', group: 'answer', title: '42', subtitle: '12*(3+4)/2' });
    await card?.primary.run();
    expect(clip.copyText).toHaveBeenCalledWith('42', '');
    expect(card?.primary).toMatchObject({ hotkey: 'mod+c', feedback: 'copied', record: false });
  });

  it('keeps the Home dropdown open after copying, and lets the palette close after the animation', () => {
    expect(view('2+2', ctx({ surface: 'home' })).results[0]?.primary).toMatchObject({ keepOpen: true, closeDelay: undefined });
    expect(view('2+2', ctx({ surface: 'palette' })).results[0]?.primary).toMatchObject({ keepOpen: false, closeDelay: 700 });
  });

  it('offers copy-expression, per-format copies and "search the web instead"', () => {
    const labels = (q: string) => view(q, ctx()).results[0]?.actions?.map((a) => a.label);
    // the expression is skipped when it is exactly what ↵ already copies ("#ff8800")
    expect(labels('#ff8800')).toEqual(['Copy HEX', 'Copy RGB', 'Copy HSL', 'Copy OKLCH', 'Search the web instead']);
    expect(labels('uuid')).toContain('Roll again');
    expect(labels('15% of 240')).toEqual(['Copy expression', 'Search the web instead']);
  });

  it('"Open in <tool>" appears only when the host provides a way to open tools (signed in)', () => {
    const open = vi.fn();
    const guest = view('10 km in mi', ctx()).results[0]?.actions?.map((a) => a.label);
    const user = view('10 km in mi', ctx({ signedIn: true }), { openTool: open }).results[0]?.actions;
    expect(guest).not.toContain('Open in Unit converter');
    const act = user?.find((a) => a.id === 'open-tool');
    expect(act?.label).toBe('Open in Unit converter');
    void act?.run();
    expect(open).toHaveBeenCalledWith('convert');
  });

  it('re-rolling asks the host to recompute', () => {
    const c = ctx();
    void view('flip a coin', c)
      .results[0]?.actions?.find((a) => a.id === 'reroll')
      ?.run();
    expect(c.refresh).toHaveBeenCalled();
  });

  it('computes nothing for ordinary searches', () => {
    expect(ids('best pizza near me').some((id) => id === 'answer')).toBe(false);
  });
});

describe('Home layout of web / url / bang results', () => {
  it('plain text: the literal web search is the top hit', () => {
    const v = view('lofi beats', ctx());
    expect(v.sections.map((s) => s.id)).toEqual(['top']);
    expect(v.results[0]).toMatchObject({ id: 'web-search', title: 'Search the web for “lofi beats”' });
  });

  it('an address becomes the top hit and the literal search is not offered', () => {
    const v = view('github.com', ctx());
    expect(v.results.map((r) => r.id)).toEqual(['top-url']);
    expect(v.results[0]?.title).toBe('Open github.com');
    expect(v.results[0]?.site?.url).toBe('https://github.com');
  });

  it('a calculation shows the card, then the literal search below it', () => {
    expect(ids('2+2')).toEqual(['answer', 'web-search']);
  });

  it('palette: the web fallback sits last, in the Web group', () => {
    const v = view('lofi beats', ctx({ surface: 'palette' }));
    expect(v.sections.map((s) => s.id)).toEqual(['web']);
  });

  it('!yt lofi is a site search, not a web search', () => {
    const v = view('!yt lofi beats', ctx());
    expect(v.results.map((r) => r.id)).toEqual(['top-bang']);
    expect(v.results[0]?.title).toBe('Search YouTube for “lofi beats”');
    const record = vi.fn();
    void coreProviders({ recordSearch: record })
      .flatMap((p) => p('!yt lofi beats', ctx()))
      .find((r) => r.id === 'top-bang')
      ?.primary.run();
    expect(ext.openUrl).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=lofi%20beats');
    expect(record).toHaveBeenCalledWith('!yt lofi beats');
  });

  it('a bare !gh opens the site', () => {
    const v = view('!gh', ctx());
    expect(v.results[0]?.title).toBe('Open GitHub');
    void v.results[0]?.primary.run();
    expect(ext.openUrl).toHaveBeenCalledWith('https://github.com/');
  });
});

describe('bang discovery and the ghost', () => {
  it('typing the start of a site offers "Search <site>" with a completion that makes a chip', () => {
    const v = view('yout', ctx({ surface: 'palette' }));
    const row = v.results.find((r) => r.id === 'bang:youtube');
    expect(row).toMatchObject({ group: 'web', title: 'Search YouTube' });
    expect(row?.primary.scope).toBe('youtube');
    expect(v.ghost).toEqual({ text: 'youtube', resultId: 'bang:youtube', scope: 'youtube' });
  });

  it('an exact trigger lists the site but offers no ghost (Tab makes the chip)', () => {
    const v = view('gh', ctx({ surface: 'palette' }));
    expect(v.results[0]?.id).toBe('bang:github');
    expect(v.ghost).toBeNull();
  });

  it('typing "!y" lists the sites whose triggers start with y', () => {
    const titles = view('!y', ctx({ surface: 'palette' })).results.map((r) => r.title);
    expect(titles).toContain('Search YouTube');
    expect(view('!y', ctx()).ghost?.text).toBe('!yt');
  });

  it('single letters need the ! — plain "w" finds nothing', () => {
    expect(view('w', ctx({ surface: 'palette' })).results.map((r) => r.id)).toEqual(['web-search']);
  });
});

describe('scoped (chip) mode', () => {
  const scoped = (q: string) => view(q, ctx({ scope: 'youtube' }));

  it('offers only that site', () => {
    expect(scoped('lofi').results.map((r) => r.id)).toEqual(['top-bang']);
    expect(scoped('lofi').results[0]?.title).toBe('Search YouTube for “lofi”');
    expect(scoped('').results[0]?.title).toBe('Open YouTube');
    expect(scoped('2+2').results).toHaveLength(1); // no calculator inside a chip
  });

  it('opens in a new tab with the secondary action', () => {
    const a = scoped('lofi').results[0]?.actions?.find((x) => x.hotkey === 'mod+enter');
    void a?.run();
    expect(ext.openUrl).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=lofi', { newTab: true });
  });
});

describe('submitText', () => {
  it('routes to a bang, an address or the default search engine', () => {
    const recordSearch = vi.fn();
    submitText('!w alan turing', { recordSearch });
    expect(ext.openUrl).toHaveBeenLastCalledWith('https://en.wikipedia.org/w/index.php?search=alan%20turing', {});
    submitText('example.com', { recordSearch });
    expect(ext.openUrl).toHaveBeenLastCalledWith('https://example.com', {});
    submitText('  cat food  ', { recordSearch });
    expect(ext.webSearch).toHaveBeenCalledWith('cat food', {});
    expect(recordSearch.mock.calls.map((c) => c[0])).toEqual(['!w alan turing', 'cat food']);
    submitText('   ');
    expect(ext.webSearch).toHaveBeenCalledTimes(1);
  });
});
