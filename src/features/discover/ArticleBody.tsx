import { createElement, memo, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { SafeElement, SafeNode, SafeTag } from './sanitize';

/** Reading typography for an article body. Every element is built from the sanitiser's tree — nothing here parses markup. */
const CLASS: Partial<Record<SafeTag, string>> = {
  p: 'my-4',
  div: 'my-0',
  h1: 'mb-3 mt-9 text-[26px] font-semibold leading-tight tracking-tight',
  h2: 'mb-3 mt-8 text-[22px] font-semibold leading-snug tracking-tight',
  h3: 'mb-2 mt-7 text-[18px] font-semibold leading-snug tracking-tight',
  h4: 'mb-2 mt-6 text-base font-semibold',
  ul: 'my-4 list-disc space-y-1.5 pl-6 marker:text-subtle-foreground',
  ol: 'my-4 list-decimal space-y-1.5 pl-6 marker:text-subtle-foreground',
  li: 'pl-1',
  blockquote: 'my-6 border-l-2 border-brand pl-5 text-[17px] italic leading-relaxed text-muted-foreground [&>p]:my-2',
  pre: 'my-5 overflow-x-auto rounded-md bg-muted p-4 font-mono text-[13px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0',
  code: 'rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.88em]',
  a: 'text-brand-text underline decoration-brand-text/40 underline-offset-[3px] transition-colors hover:decoration-current',
  strong: 'font-semibold text-foreground',
  b: 'font-semibold text-foreground',
  figure: 'my-6',
  figcaption: 'mt-2 text-center text-xs leading-relaxed text-muted-foreground',
  hr: 'my-8 border-0 border-t',
  table: 'w-full border-collapse text-sm',
  th: 'border bg-muted px-3 py-2 text-left align-top font-semibold',
  td: 'border px-3 py-2 text-left align-top',
  caption: 'mb-2 text-xs text-muted-foreground',
  mark: 'rounded-sm bg-warning-soft px-0.5',
  kbd: 'rounded-sm border bg-muted px-1 font-mono text-[0.85em]',
  small: 'text-[0.85em] text-muted-foreground',
  dt: 'mt-3 font-semibold',
  dd: 'ml-5',
  sup: 'text-[0.75em]',
  sub: 'text-[0.75em]',
};

function str(el: SafeElement, key: string): string | undefined {
  const v = el.attrs?.[key];
  return typeof v === 'string' ? v : undefined;
}
function num(el: SafeElement, key: string): number | undefined {
  const v = el.attrs?.[key];
  return typeof v === 'number' ? v : undefined;
}

function render(node: SafeNode, key: number): ReactNode {
  if (typeof node === 'string') return node;
  const kids = node.children.map(render);

  switch (node.tag) {
    case 'img': {
      const w = num(node, 'width');
      const small = w !== undefined && w < 64; // an emoji or an icon in the middle of a sentence
      return (
        <img
          key={key}
          src={str(node, 'src')}
          alt={str(node, 'alt') ?? ''}
          width={w}
          height={num(node, 'height')}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={small ? 'inline-block h-[1.1em] w-auto align-text-bottom' : 'my-5 block h-auto max-w-full rounded-md'}
        />
      );
    }
    case 'a':
      return (
        <a key={key} href={str(node, 'href')} target="_blank" rel="noopener noreferrer" className={CLASS.a}>
          {kids}
        </a>
      );
    case 'br':
      return <br key={key} />;
    case 'table':
      return (
        <div key={key} className="my-5 overflow-x-auto">
          <table className={CLASS.table}>{kids}</table>
        </div>
      );
    case 'td':
    case 'th':
      return createElement(node.tag, { key, className: CLASS[node.tag], colSpan: num(node, 'colSpan'), rowSpan: num(node, 'rowSpan') }, kids);
    case 'ol':
      return (
        <ol key={key} className={CLASS.ol} start={num(node, 'start')}>
          {kids}
        </ol>
      );
    default:
      return createElement(node.tag, { key, className: CLASS[node.tag] }, ...(node.children.length ? kids : []));
  }
}

/** The text of an article at a comfortable reading width and rhythm. */
export const ArticleBody = memo(function ArticleBody({ nodes, className }: { nodes: readonly SafeNode[]; className?: string }) {
  return (
    <div className={cn('text-[16.5px] leading-[1.75] text-foreground/90 [overflow-wrap:anywhere] [&>*:first-child]:mt-0', className)}>{nodes.map(render)}</div>
  );
});
