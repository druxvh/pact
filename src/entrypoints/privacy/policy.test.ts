import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COMMENT_MAX, MESSAGE_MAX, NOTE_MAX, NOTE_TTL_HOURS } from '@/features/activity/types';
import { MUSIC_PAGE_HOSTS } from '@/features/nowplaying/sources';
import { PrivacyPage } from './PrivacyPage';
import { headingsOf, policyMarkdown, slug, titleOf } from './policy';

const root = resolve(__dirname, '../../..');
const file = readFileSync(resolve(root, 'PRIVACY.md'), 'utf8');

describe('the policy text', () => {
  it('is the repo-root PRIVACY.md — one source for the store listing and the in-extension page', () => {
    expect(policyMarkdown).toBe(file.replace(/<!--[\s\S]*?-->\s*/g, '').trim());
  });

  it('keeps the publisher’s checklist out of what people read', () => {
    expect(file).toContain('OWNER CHECKLIST');
    expect(policyMarkdown).not.toContain('OWNER CHECKLIST');
    expect(policyMarkdown).not.toContain('<!--');
  });

  it('marks everything only the owner can fill in as a visible TODO (contact, dates, region, deletion process)', () => {
    const todos = policyMarkdown.match(/TODO\(owner\)/g) ?? [];
    expect(todos.length).toBeGreaterThanOrEqual(6);
    expect(policyMarkdown).toMatch(/privacy@pact\.example/);
    expect(policyMarkdown).toMatch(/Effective date/);
  });

  it('declares every permission the manifest asks for, with a reason', () => {
    const config = readFileSync(resolve(root, 'wxt.config.ts'), 'utf8');
    const list = /permissions:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '';
    const permissions = [...list.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1] as string);
    expect(permissions.length).toBeGreaterThanOrEqual(7);
    for (const p of permissions) expect(policyMarkdown, `permission ${p}`).toContain(`\`${p}\``);
    expect(policyMarkdown).toContain('www.youtube.com');
    for (const host of config.match(/https:\/\/[a-z.]+/g) ?? []) expect(policyMarkdown, host).toContain(new URL(host).hostname);
  });

  it('covers what really leaves the device: accounts, sync, communities, GIFs, link previews, VibeParty — and the no-tracking promise', () => {
    for (const word of ['Supabase', 'GitHub', 'Google', 'KLIPY', 'Link previews', 'VibeParty', 'Communities', 'notes', 'row-level security', 'children']) {
      expect(policyMarkdown, word).toContain(word);
    }
    expect(policyMarkdown).toMatch(/never sell/i);
    expect(policyMarkdown).toMatch(/No analytics/);
  });

  it('declares the optional music-site access Now playing asks for — every host, and that it is optional and off by default', () => {
    for (const host of MUSIC_PAGE_HOSTS) expect(policyMarkdown, host).toContain(`\`${host}\``);
    expect(policyMarkdown).toMatch(/Now playing \(optional, off by default\)/);
    expect(policyMarkdown).toMatch(/Optional access to/);
    expect(policyMarkdown).toMatch(/Not requested at install/);
  });

  it('says honestly what Now playing reads, when it is sent, who sees it, how long it exists and how to turn it off', () => {
    const section = /\*\*Now playing \(optional, off by default\)\.\*\*[\s\S]*?\n\*\*Link previews\./.exec(policyMarkdown)?.[0] ?? '';
    expect(section.length).toBeGreaterThan(1500);
    for (const phrase of [
      'track title, artist, album',
      'never sends the address or title of any tab',
      'Nothing is sent to us',
      'My communities',
      'Everyone',
      'about every 30 seconds',
      'no history',
      '2 minutes',
      'Turn it off',
      'Cover',
    ]) {
      expect(section, phrase).toContain(phrase);
    }
    expect(policyMarkdown).toContain('`scripting`');
  });

  it('says honestly what Activity stores: notes for 24 hours, hearts, comments, the inbox — who sees them, how long they last, how to turn it off', () => {
    const section = /\*\*Activity \(24-hour notes, hearts, comments and replies\)\.\*\*[\s\S]*?\n## 4\./.exec(policyMarkdown)?.[0] ?? '';
    expect(section.length).toBeGreaterThan(2500);
    for (const phrase of [
      `${NOTE_MAX} characters`,
      `${COMMENT_MAX} characters`,
      `${MESSAGE_MAX} characters`,
      `${NOTE_TTL_HOURS} hours`,
      'deleted from our database',
      'My communities',
      'Everyone',
      'Nobody',
      'Only the person who gave a heart and the owner',
      'activity message',
      'until the person who received them deletes them, or until either account is deleted',
      'only place a song someone was listening to can be kept',
      'still keeps no history',
      'plain text',
      'set by the server',
      'Turn it off',
    ]) {
      expect(section, phrase).toContain(phrase);
    }
    // the retention list and the choices list agree with it
    expect(policyMarkdown).toMatch(/An Activity note lasts 24 hours/);
    expect(policyMarkdown).toMatch(/Share less, or nothing, in Activity/);
    // and the places that said "notes" or "direct messages" before Activity existed no longer mislead
    expect(policyMarkdown).toMatch(/Likes, comments and replies from \*Activity\* are different/);
  });

  it('describes the capture popup and the main focus data it now stores on the device', () => {
    expect(policyMarkdown).toMatch(/Quick capture/);
    expect(policyMarkdown).toMatch(/main focus/i);
  });

  it('has a table of contents with unique anchors', () => {
    const toc = headingsOf(policyMarkdown);
    expect(toc.length).toBeGreaterThanOrEqual(10);
    expect(new Set(toc.map((h) => h.id)).size).toBe(toc.length);
    expect(titleOf(policyMarkdown)).toMatch(/Privacy Policy/);
    expect(slug('6. Permissions, and why')).toBe('6-permissions-and-why');
  });
});

describe('the policy page', () => {
  it('renders offline from the bundled text: heading, contents, permission table and anchors', () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('On this page');
    expect(html).toContain('<table>');
    expect(html).toContain('id="6-permissions-and-why"');
    expect(html).toContain('href="#6-permissions-and-why"');
    expect(html).toContain('href="/newtab.html"');
    expect(html).not.toContain('OWNER CHECKLIST');
  });
});
