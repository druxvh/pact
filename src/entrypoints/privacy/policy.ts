/**
 * The privacy policy text. `PRIVACY.md` at the repo root is the ONE source: the store listing links to it, and this page
 * renders the very same file (Vite inlines it at build time, so the page works offline). Edit the Markdown, nothing else.
 */
import source from '../../../PRIVACY.md?raw';

export type Heading = { id: string; text: string };

/** The Markdown with the owner's HTML comment (a checklist for the person publishing) removed — it isn't part of the policy. */
export const policyMarkdown: string = source.replace(/<!--[\s\S]*?-->\s*/g, '').trim();

export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The `##` section headings, for the table of contents. */
export function headingsOf(markdown: string): Heading[] {
  return [...markdown.matchAll(/^## (.+)$/gm)].map((m) => {
    const text = (m[1] ?? '').trim();
    return { id: slug(text), text };
  });
}

/** The title (`# …`). */
export function titleOf(markdown: string): string {
  return /^# (.+)$/m.exec(markdown)?.[1]?.trim() ?? 'Privacy policy';
}
