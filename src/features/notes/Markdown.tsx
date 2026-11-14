import { type ComponentProps, createContext, useContext } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const LineContext = createContext<number | null>(null);
const ToggleContext = createContext<((line: number) => void) | null>(null);

function TaskInput({ type, checked }: ComponentProps<'input'>) {
  const line = useContext(LineContext);
  const toggle = useContext(ToggleContext);
  if (type !== 'checkbox') return <input type={type} readOnly />;
  return <input type="checkbox" checked={Boolean(checked)} aria-label="Toggle task" onChange={() => line != null && toggle?.(line)} />;
}

function SafeLink({ href, children }: ComponentProps<'a'>) {
  const safe = Boolean(href && /^(https?:|mailto:)/i.test(href));
  return (
    <a href={safe ? href : undefined} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

// Static, so React never remounts checkboxes between renders.
const components: Components = {
  li({ node, className, children }) {
    return (
      <LineContext.Provider value={node?.position?.start.line ?? null}>
        <li className={className}>{children}</li>
      </LineContext.Provider>
    );
  },
  input: TaskInput,
  a: SafeLink,
};

export default function Markdown({ source, onToggleLine }: { source: string; onToggleLine: (line: number) => void }) {
  return (
    <ToggleContext.Provider value={onToggleLine}>
      <div className="prose-pact">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {source}
        </ReactMarkdown>
      </div>
    </ToggleContext.Provider>
  );
}
