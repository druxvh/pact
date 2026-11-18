import { describe, expect, it } from 'vitest';
import { sanitizeLinks } from '@/lib/socialLinks';
import { DEMO_DIRECTORY } from '@/store/useUserStore';
import type { Person } from '@/types/user';
import { DEMO_LINKS } from './demoLinks';
import { personCard } from './PersonHover';

const person = (over: Partial<Person> = {}): Person => ({
  id: 'x',
  displayName: 'Xan',
  username: 'xan',
  designation: '',
  bio: '',
  email: '',
  isOnline: true,
  ...over,
});

describe('demo friends’ profile cards', () => {
  it('every sample link is valid as written (https, on the platform’s own host), and there are at most five per person', () => {
    for (const [id, links] of Object.entries(DEMO_LINKS)) {
      expect(links.length, id).toBeGreaterThan(0);
      expect(links.length, id).toBeLessThanOrEqual(5);
      expect(sanitizeLinks(links), id).toEqual(links);
    }
  });

  it('only real people in the directory have sample links, and at least three do', () => {
    const ids = new Set(DEMO_DIRECTORY.map((p) => p.id));
    for (const id of Object.keys(DEMO_LINKS)) expect(ids.has(id), id).toBe(true);
    expect(Object.keys(DEMO_LINKS).length).toBeGreaterThanOrEqual(3);
  });

  it('maps a person: designation is the role line, empty parts are left out', () => {
    const alex = DEMO_DIRECTORY.find((p) => p.id === 'alex') as Person;
    expect(personCard(alex)).toMatchObject({ name: 'Alex Rivera', username: 'alex', role: 'Product Designer', bio: alex.bio, links: DEMO_LINKS.alex });
    const bare = personCard(person());
    expect(bare).toMatchObject({ name: 'Xan', username: 'xan' });
    expect(bare.role).toBeUndefined();
    expect(bare.bio).toBeUndefined();
    expect(bare.links).toBeUndefined();
  });

  it('a person’s own links win over the samples (that is what a real profile will carry)', () => {
    const own = [{ kind: 'github' as const, url: 'https://github.com/own' }];
    expect(personCard(person({ id: 'alex', links: own })).links).toEqual(own);
    expect(personCard(person({ id: 'alex' })).links).toEqual(DEMO_LINKS.alex);
  });
});
