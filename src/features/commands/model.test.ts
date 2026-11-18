import { describe, expect, it } from 'vitest';
import {
  aliasIndex,
  aliasOwner,
  availableSuggestions,
  type CommandDraft,
  type CustomCommand,
  cleanIcon,
  customBangsFrom,
  draftOf,
  duplicateDraft,
  emptyDraft,
  exportCommands,
  freeAlias,
  IMPORT_MAX_BYTES,
  MAX_COMMANDS,
  mergeImported,
  migrateCommands,
  NAME_MAX,
  parseImport,
  quicklinkToBang,
  repairCommands,
  SUGGESTIONS,
  sanitizeCommand,
  validateDraft,
} from '@/features/commands/model';

const NOW = '2026-11-17T12:00:00.000Z';
let n = 0;
const makeId = () => `id${++n}`;
const ql = (over: Partial<CommandDraft> = {}): CommandDraft => ({
  ...emptyDraft('quicklink'),
  name: 'Repos',
  alias: 'repo',
  url: 'https://github.com/search?q={query}',
  ...over,
});
const make = (draft: CommandDraft, existing: CustomCommand[] = []): CustomCommand => {
  const r = validateDraft(draft, existing, { now: NOW, makeId });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.item;
};

describe('validateDraft', () => {
  it('builds a quicklink, normalising the alias and keeping only declared fields', () => {
    const item = make(ql({ name: '  Repos  ', alias: '!Repo ' }));
    expect(item).toMatchObject({
      kind: 'quicklink',
      name: 'Repos',
      alias: 'repo',
      url: 'https://github.com/search?q={query}',
      icon: '',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('needs a name, and an address that is http(s)', () => {
    const r = validateDraft(ql({ name: ' ', url: 'javascript:alert(1)' }), [], { now: NOW });
    expect(r).toMatchObject({ ok: false, errors: { name: expect.any(String), url: expect.stringMatching(/http/) } });
  });

  it('the alias is optional for quicklinks and snippets, required for aliases', () => {
    expect(validateDraft(ql({ alias: '' }), [], { now: NOW }).ok).toBe(true);
    expect(validateDraft({ ...emptyDraft('snippet'), name: 'S', text: 'x' }, [], { now: NOW }).ok).toBe(true);
    const r = validateDraft({ ...emptyDraft('alias'), name: 'Focus', target: 'page:timer' }, [], { now: NOW });
    expect(r).toMatchObject({ ok: false, errors: { alias: expect.any(String) } });
  });

  it('rejects a badly formed alias with a clear message', () => {
    const r = validateDraft(ql({ alias: 'my repo!' }), [], { now: NOW });
    expect(r).toMatchObject({ ok: false, errors: { alias: expect.stringMatching(/lowercase letters, digits and dashes/) } });
  });

  it('rejects an alias a built-in search already owns — and says which', () => {
    for (const taken of ['gh', 'yt', 'w', 'maps', 'g']) {
      const r = validateDraft(ql({ alias: taken }), [], { now: NOW });
      expect(r, taken).toMatchObject({ ok: false, errors: { alias: expect.stringContaining('already used by the built-in') } });
    }
    expect(validateDraft(ql({ alias: 'gh' }), [], { now: NOW })).toMatchObject({ errors: { alias: expect.stringContaining('GitHub') } });
  });

  it('rejects an alias another command uses (of any kind), but not its own when editing', () => {
    const a = make(ql({ name: 'Mine', alias: 'mine' }));
    expect(validateDraft({ ...emptyDraft('snippet'), name: 'S', alias: 'MINE', text: 'x' }, [a], { now: NOW })).toMatchObject({
      ok: false,
      errors: { alias: expect.stringContaining('your quicklink “Mine”') },
    });
    expect(validateDraft(ql({ name: 'Mine 2', alias: 'mine' }), [a], { now: NOW, id: a.id, createdAt: a.createdAt }).ok).toBe(true);
  });

  it('keeps id and creation time when editing', () => {
    const a = make(ql());
    const r = validateDraft(ql({ name: 'Renamed' }), [a], { now: '2027-01-01T00:00:00.000Z', id: a.id, createdAt: a.createdAt });
    expect(r).toMatchObject({ ok: true, item: { id: a.id, createdAt: NOW, updatedAt: '2027-01-01T00:00:00.000Z', name: 'Renamed' } });
  });

  it('snippets need text within the limit; aliases need a well-formed target', () => {
    expect(validateDraft({ ...emptyDraft('snippet'), name: 'S', text: '   ' }, [], { now: NOW })).toMatchObject({ errors: { text: expect.any(String) } });
    expect(validateDraft({ ...emptyDraft('snippet'), name: 'S', text: 'x'.repeat(4001) }, [], { now: NOW })).toMatchObject({
      errors: { text: expect.stringMatching(/too long/) },
    });
    expect(validateDraft({ ...emptyDraft('alias'), name: 'X', alias: 'x', target: 'javascript:1' }, [], { now: NOW })).toMatchObject({
      errors: { target: expect.any(String) },
    });
    expect(validateDraft({ ...emptyDraft('alias'), name: 'T', alias: 't', target: 'page:timer' }, [], { now: NOW }).ok).toBe(true);
  });

  it('enforces the cap on new commands only', () => {
    const full = Array.from({ length: MAX_COMMANDS }, (_, i) => make(ql({ name: `n${i}`, alias: '' })));
    expect(validateDraft(ql({ alias: '' }), full, { now: NOW })).toMatchObject({ ok: false, errors: { form: expect.stringContaining(String(MAX_COMMANDS)) } });
    const first = full[0] as CustomCommand;
    expect(validateDraft(ql({ alias: '' }), full, { now: NOW, id: first.id }).ok).toBe(true);
  });

  it('flags names longer than the limit instead of cutting them', () => {
    expect(validateDraft(ql({ name: 'x'.repeat(NAME_MAX + 1) }), [], { now: NOW })).toMatchObject({ errors: { name: expect.any(String) } });
  });
});

describe('aliases helpers', () => {
  it('aliasOwner / freeAlias', () => {
    const a = make(ql({ alias: 'repo' }));
    expect(aliasOwner('repo', [a])).toContain('Repos');
    expect(aliasOwner('free', [a])).toBeNull();
    expect(freeAlias('repo', [a])).toBe('repo-2');
    expect(freeAlias('gh', [])).toBe('gh-2');
    expect(freeAlias('fresh', [a])).toBe('fresh');
    expect(freeAlias('x'.repeat(24), []).length).toBeLessThanOrEqual(24);
  });

  it('aliasIndex maps an alias to the result ids it names', () => {
    const t = make({ ...emptyDraft('alias'), name: 'Focus', alias: 't', target: 'page:timer' });
    const p = make({ ...emptyDraft('alias'), name: 'Split PDF', alias: 'pdf', target: 'tool:pdf-split' });
    expect(aliasIndex([t, p, make(ql())])).toEqual({ t: ['page:timer'], pdf: ['tool:pdf-split'] });
  });

  it('only quicklinks with an alias and a {query} become bangs', () => {
    const search = make(ql({ alias: 'repo' }));
    const plain = make(ql({ name: 'Docs', alias: 'docs', url: 'https://docs.example.com/' }));
    const noAlias = make(ql({ name: 'Nameless', alias: '' }));
    const snip = make({ ...emptyDraft('snippet'), name: 'S', alias: 'sig', text: 'x' });
    const bangs = customBangsFrom([search, plain, noAlias, snip]);
    expect(bangs).toHaveLength(1);
    expect(bangs[0]).toMatchObject({ id: `ql:${search.id}`, name: 'Repos', triggers: ['repo'], custom: true, home: 'https://github.com/' });
    expect(quicklinkToBang(search as never).url).toBe('https://github.com/search?q={query}');
  });
});

describe('icons', () => {
  it('keeps a known glyph or a real emoji, and turns anything else into the favicon', () => {
    expect(cleanIcon('icon:rocket')).toBe('icon:rocket');
    expect(cleanIcon('emoji:🍵')).toBe('emoji:🍵');
    expect(cleanIcon('emoji:abc')).toBe('');
    expect(cleanIcon('icon:../../x')).toBe('');
    expect(cleanIcon('https://evil.example/x.png')).toBe('');
    expect(cleanIcon(5)).toBe('');
  });
});

describe('sanitizeCommand (anything from storage or a file)', () => {
  const base = { id: 'a', kind: 'quicklink', name: 'A', alias: '', url: 'https://example.com/', icon: '', createdAt: NOW, updatedAt: NOW };

  it('accepts a good one and rebuilds it field by field', () => {
    expect(sanitizeCommand({ ...base, evil: 1 })).toEqual(base);
  });

  it('drops what cannot be repaired and repairs what can', () => {
    expect(sanitizeCommand(null)).toBeNull();
    expect(sanitizeCommand('x')).toBeNull();
    expect(sanitizeCommand({ ...base, kind: 'wat' })).toBeNull();
    expect(sanitizeCommand({ ...base, id: '' })).toBeNull();
    expect(sanitizeCommand({ ...base, name: '   ' })).toBeNull();
    expect(sanitizeCommand({ ...base, url: 'javascript:alert(1)' })).toBeNull();
    expect(sanitizeCommand({ ...base, kind: 'snippet', text: '' })).toBeNull();
    expect(sanitizeCommand({ ...base, kind: 'alias', alias: '', target: 'page:timer' })).toBeNull();
    expect(sanitizeCommand({ ...base, alias: 'Not Valid!' })).toMatchObject({ alias: '' });
    expect(sanitizeCommand({ ...base, createdAt: 'garbage' }, { now: NOW })).toMatchObject({ createdAt: NOW });
    expect(sanitizeCommand({ ...base, name: 'n'.repeat(99) })).toMatchObject({ name: 'n'.repeat(NAME_MAX) });
  });

  it('makes an id when the data has none (imports)', () => {
    expect(sanitizeCommand({ ...base, id: undefined }, { makeId: () => 'fresh' })).toMatchObject({ id: 'fresh' });
  });
});

describe('repairCommands', () => {
  it('keeps ids and aliases unique, strips built-in aliases, caps the size', () => {
    const a = make(ql({ name: 'A', alias: 'one' }));
    const b = { ...make(ql({ name: 'B', alias: '' })), alias: 'one' } as CustomCommand;
    const c = { ...make(ql({ name: 'C', alias: '' })), alias: 'gh' } as CustomCommand;
    const al = { ...make({ ...emptyDraft('alias'), name: 'Focus', alias: 'foc', target: 'page:timer' }), alias: 'one' } as CustomCommand;
    const dupId = { ...a, name: 'again' } as CustomCommand;
    const out = repairCommands([a, b, c, al, dupId]);
    expect(out.map((x) => [x.name, x.alias])).toEqual([
      ['A', 'one'],
      ['B', ''],
      ['C', ''],
    ]);
    const many = Array.from({ length: MAX_COMMANDS + 20 }, (_, i) => ({ ...a, id: `m${i}`, alias: '' }) as CustomCommand);
    expect(repairCommands(many)).toHaveLength(MAX_COMMANDS);
  });
});

describe('migrateCommands', () => {
  it('reads the current shape, cleaning every item', () => {
    const good = { id: 'a', kind: 'quicklink', name: 'A', alias: 'a1', url: 'https://example.com/', icon: '', createdAt: NOW, updatedAt: NOW };
    expect(migrateCommands({ items: [good, { id: 'bad', kind: 'quicklink', name: 'x', url: 'javascript:1' }] }, 1).items).toEqual([good]);
  });

  it('upgrades the older shape that kept three lists', () => {
    const out = migrateCommands(
      {
        quicklinks: [{ id: 'q', name: 'Q', alias: 'q1', url: 'https://example.com/{query}' }],
        snippets: [{ id: 's', name: 'S', text: 'hi' }],
        aliases: [{ id: 'a', name: 'Focus', alias: 't', target: 'page:timer' }],
      },
      0,
    ).items;
    expect(out.map((x) => [x.kind, x.id])).toEqual([
      ['quicklink', 'q'],
      ['snippet', 's'],
      ['alias', 'a'],
    ]);
  });

  it('never throws on rubbish', () => {
    for (const bad of [null, undefined, 5, 'x', [], { items: 5 }, { items: [null, 1, 'x'] }]) expect(migrateCommands(bad, 0).items).toEqual([]);
  });
});

describe('import / export', () => {
  const a = make(ql({ name: 'Repos', alias: 'repo' }));
  const s = make({ ...emptyDraft('snippet'), name: 'Sig', alias: 'sig', text: 'Best,\nMe' });

  it('round-trips through a file, always with fresh ids', () => {
    const parsed = parseImport(exportCommands([a, s]), makeId);
    expect(parsed).toMatchObject({ ok: true, invalid: 0 });
    if (!parsed.ok) return;
    expect(parsed.items.map((x) => x.name)).toEqual(['Repos', 'Sig']);
    expect(parsed.items.map((x) => x.id)).not.toContain(a.id);
  });

  it('accepts a bare array, counts bad entries and refuses non-commands files', () => {
    const arr = parseImport(JSON.stringify([a, { nonsense: true }, 5]), makeId);
    expect(arr).toMatchObject({ ok: true, invalid: 2 });
    expect(parseImport('nope', makeId)).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });
    expect(parseImport('{"hello":1}', makeId)).toMatchObject({ ok: false });
    expect(parseImport(' '.repeat(IMPORT_MAX_BYTES + 1), makeId)).toMatchObject({ ok: false, error: expect.stringMatching(/too big/) });
  });

  it('only scans a bounded number of entries', () => {
    const lots = JSON.stringify({ items: Array.from({ length: 1500 }, () => ({ kind: 'snippet', name: 'x', text: 'y' })) });
    const r = parseImport(lots, makeId);
    expect(r.ok && r.items.length).toBe(1000);
    expect(r.ok && r.invalid).toBe(500);
  });

  it('a malicious file cannot bring a bad address along', () => {
    const r = parseImport(
      JSON.stringify([
        { kind: 'quicklink', name: 'x', url: 'javascript:alert(1)' },
        { kind: 'quicklink', name: 'y', url: 'https://ok.example/' },
      ]),
      makeId,
    );
    expect(r.ok && r.items.map((x) => x.name)).toEqual(['y']);
  });

  it('mergeImported skips what is already there, drops clashing aliases and respects the cap', () => {
    const again = make(ql({ name: 'Repos', alias: 'repo' }), []); // same thing, different id
    const clash = make(ql({ name: 'Other', alias: 'repo', url: 'https://other.example/{query}' }), []);
    const aliasClash = make({ ...emptyDraft('alias'), name: 'Focus', alias: 'repo', target: 'page:timer' }, []);
    const fresh = make(ql({ name: 'New', alias: 'new1', url: 'https://new.example/' }), []);
    const { items, report } = mergeImported([a], [again, clash, aliasClash, fresh], 2);
    expect(report).toEqual({ added: 2, duplicates: 1, invalid: 2, aliasDropped: 2, overLimit: 0 });
    expect(items.map((x) => [x.name, x.alias])).toEqual([
      ['Repos', 'repo'],
      ['Other', ''],
      ['New', 'new1'],
    ]);
    const filler = Array.from({ length: MAX_COMMANDS }, (_, i) => make(ql({ name: `f${i}`, alias: '', url: `https://f${i}.example/` })));
    expect(mergeImported(filler, [fresh]).report.overLimit).toBe(1);
  });
});

describe('duplicate and suggestions', () => {
  it('a duplicate can be saved as is: new alias, "(copy)" name within the limit', () => {
    const a = make(ql({ name: 'x'.repeat(NAME_MAX), alias: 'repo' }));
    const d = duplicateDraft(a, [a]);
    expect(d.alias).toBe('repo-2');
    expect(d.name.endsWith(' (copy)')).toBe(true);
    expect(d.name.length).toBeLessThanOrEqual(NAME_MAX);
    expect(validateDraft(d, [a], { now: NOW }).ok).toBe(true);
    expect(draftOf(a).url).toBe(a.kind === 'quicklink' ? a.url : '');
  });

  it('every suggestion is itself valid and clashes with no built-in alias', () => {
    for (const s of SUGGESTIONS) expect(validateDraft(s.draft, [], { now: NOW }).ok, s.id).toBe(true);
    expect(availableSuggestions([])).toHaveLength(SUGGESTIONS.length);
    const taken = make(SUGGESTIONS[0]?.draft as CommandDraft);
    expect(availableSuggestions([taken]).map((s) => s.id)).not.toContain(SUGGESTIONS[0]?.id);
  });
});
