import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `getProfiles` selects `bio, links` (and `avatar_path`), columns added by recent migrations. A database that hasn't had them
 * yet answers "column does not exist"; the client must degrade (links → avatar_path → base) instead of breaking, and must not ask
 * again for a column it has learned is missing.
 */

type Answer = { data: unknown; error: unknown };
const calls: string[] = [];
let answer: (cols: string) => Answer;

const fake = {
  from: (table: string) => ({
    select: (cols: string) => ({
      in: async () => {
        calls.push(`${table}: ${cols}`);
        return answer(cols);
      },
    }),
  }),
  storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/${p}` } }) }) },
};
vi.mock('@/lib/supabase/client', () => ({ supabase: fake }));

const missing = (col: string) => ({ data: null, error: { code: '42703', message: `column profiles.${col} does not exist` } });
const ROW = {
  id: 'u1',
  username: 'ann',
  display_name: 'Ann',
  designation: 'Designer',
  bio: 'Hi',
  avatar_path: 'u1/a.webp',
  links: [{ kind: 'github', url: 'https://github.com/ann' }],
};
const pick = (cols: string) => Object.fromEntries(Object.entries(ROW).filter(([k]) => cols.split(', ').includes(k)));

/** A fresh module each time: the "missing column" memory is module state, like the database it describes. */
const load = async () => {
  vi.resetModules();
  const { createSupabaseApi } = await import('./supabaseApi');
  return createSupabaseApi('me');
};

describe('getProfiles against a database that may be behind', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('a current database: one request with everything, mapped (avatar to a URL, links validated)', async () => {
    answer = (cols) => ({ data: [pick(cols)], error: null });
    const api = await load();
    const [p] = await api.getProfiles(['u1']);
    expect(calls).toEqual(['profiles: id, username, display_name, designation, bio, avatar_path, links']);
    expect(p).toMatchObject({ id: 'u1', bio: 'Hi', avatarUrl: 'https://cdn.test/u1/a.webp', links: [{ kind: 'github', url: 'https://github.com/ann' }] });
  });

  it('no links column yet: falls back without it, keeps avatars and bio, and asks only once afterwards', async () => {
    answer = (cols) => (cols.includes('links') ? missing('links') : { data: [pick(cols)], error: null });
    const api = await load();
    const [p] = await api.getProfiles(['u1']);
    expect(calls).toEqual([
      'profiles: id, username, display_name, designation, bio, avatar_path, links',
      'profiles: id, username, display_name, designation, bio, avatar_path',
    ]);
    expect(p?.avatarUrl).toBe('https://cdn.test/u1/a.webp');
    expect(p?.bio).toBe('Hi');
    expect(p && 'links' in p).toBe(false);
    calls.length = 0;
    await api.getProfiles(['u1']);
    expect(calls).toEqual(['profiles: id, username, display_name, designation, bio, avatar_path']);
  });

  it('an old database with neither: falls back to the base columns, still works', async () => {
    answer = (cols) => (/avatar_path|links/.test(cols) ? missing(cols.includes('links') ? 'links' : 'avatar_path') : { data: [pick(cols)], error: null });
    const api = await load();
    const [p] = await api.getProfiles(['u1']);
    expect(calls).toEqual([
      'profiles: id, username, display_name, designation, bio, avatar_path, links',
      'profiles: id, username, display_name, designation, bio, avatar_path',
      'profiles: id, username, display_name, designation, bio',
    ]);
    expect(p).toMatchObject({ id: 'u1', username: 'ann', bio: 'Hi' });
    expect(p && 'avatarUrl' in p).toBe(false);
  });

  it('an unrelated error is not retried into oblivion: it surfaces', async () => {
    answer = () => ({ data: null, error: { code: '42501', message: 'permission denied for table profiles' } });
    const api = await load();
    await expect(api.getProfiles(['u1'])).rejects.toBeInstanceOf(Error);
    expect(calls).toHaveLength(1);
  });

  it('nobody asked for, nothing requested', async () => {
    answer = () => ({ data: [], error: null });
    const api = await load();
    expect(await api.getProfiles([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
