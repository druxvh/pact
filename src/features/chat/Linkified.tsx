import type { ReactNode } from 'react';

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const TRAILING = /[.,!?;:]+$/;

/** Renders text with http(s) URLs as safe links (new tab, noopener). No HTML is ever injected. */
export function Linkified({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let url = m[0];
    const trail = TRAILING.exec(url)?.[0] ?? '';
    if (trail) url = url.slice(0, -trail.length);
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current"
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
