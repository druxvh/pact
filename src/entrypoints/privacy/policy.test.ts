import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
