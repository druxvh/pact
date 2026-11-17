import { ArrowLeft } from 'lucide-react';
import { type ComponentProps, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Logo } from '@/components/Logo';
import { buttonClass } from '@/components/ui';
import { headingsOf, policyMarkdown, slug } from './policy';

/** Text of a heading's children, for its anchor id. */
const textOf = (node: ComponentProps<'h2'>['children']): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : '');

const components: Components = {
  h2: ({ children }) => (
    <h2 id={slug(textOf(children))} className="scroll-mt-20">
      {children}
    </h2>
  ),
  // Only real web and mail links are clickable; anything else renders as plain text.
  a: ({ href, children }) => {
    const safe = Boolean(href && /^(https?:|mailto:)/i.test(href));
    return (
      <a href={safe ? href : undefined} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  // Wide tables scroll sideways instead of stretching the page on a phone.
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

/** The privacy policy as an offline extension page. The text is PRIVACY.md — see policy.ts. */
export function PrivacyPage() {
  const toc = useMemo(() => headingsOf(policyMarkdown), []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="surface-glass sticky top-0 z-10 border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <a href="/newtab.html" className="flex items-center gap-2 rounded-md outline-offset-4" aria-label="pact home">
            <Logo className="size-7 drop-shadow-none" />
            <span className="text-sm font-semibold tracking-tight">pact</span>
          </a>
          <a href="/newtab.html" className={buttonClass('ghost', 'sm', 'ml-auto')}>
            <ArrowLeft /> Back to pact
          </a>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:py-12">
        <nav aria-label="On this page" className="sticky top-20 hidden self-start lg:block">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">On this page</p>
          <ul className="space-y-0.5">
            {toc.map((h) => (
              <li key={h.id}>
                <a
                  href={`#${h.id}`}
                  className="block rounded-md px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {h.text.replace(/^\d+\.\s*/, '')}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0">
          <article className="prose-pact max-w-3xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {policyMarkdown}
            </ReactMarkdown>
          </article>
        </main>
      </div>
    </div>
  );
}
