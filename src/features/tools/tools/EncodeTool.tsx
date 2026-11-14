import { useMemo, useState } from 'react';
import { Button, Segmented, Switch, Textarea } from '@/components/ui';
import { type Result, base64Decode, base64Encode, formatJson, minifyJson, urlDecode, urlEncode } from '@/features/tools/lib/encode';
import { Field, OutputBox } from '@/features/tools/ui';

type Kind = 'url' | 'base64' | 'json';
type Dir = 'encode' | 'decode';

export function EncodeTool() {
  const [kind, setKind] = useState<Kind>('url');
  const [dir, setDir] = useState<Dir>('encode');
  const [input, setInput] = useState('');
  const [urlSafe, setUrlSafe] = useState(false);
  const [fullUri, setFullUri] = useState(false);
  const [indent, setIndent] = useState<'2' | '4' | 'tab'>('2');
  const [sort, setSort] = useState(false);
  const [minify, setMinify] = useState(false);

  const out: Result = useMemo(() => {
    if (!input) return { ok: true, value: '' };
    if (kind === 'url') return dir === 'encode' ? urlEncode(input, fullUri) : urlDecode(input);
    if (kind === 'base64') {
      if (dir === 'encode') return { ok: true, value: base64Encode(input, urlSafe) };
      return base64Decode(input);
    }
    return minify ? minifyJson(input) : formatJson(input, indent === 'tab' ? '\t' : Number(indent), sort);
  }, [input, kind, dir, urlSafe, fullUri, indent, sort, minify]);

  const showDir = kind !== 'json';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Kind>
          aria-label="Encoding"
          value={kind}
          onValueChange={(k) => {
            setKind(k);
            setInput('');
          }}
          options={[
            { value: 'url', label: 'URL' },
            { value: 'base64', label: 'Base64' },
            { value: 'json', label: 'JSON' },
          ]}
        />
        {showDir && (
          <Segmented<Dir>
            size="sm"
            aria-label="Direction"
            value={dir}
            onValueChange={setDir}
            options={[
              { value: 'encode', label: 'Encode' },
              { value: 'decode', label: 'Decode' },
            ]}
          />
        )}
        {kind === 'json' && (
          <Segmented<'2' | '4' | 'tab'>
            size="sm"
            aria-label="Indentation"
            value={indent}
            onValueChange={setIndent}
            options={[
              { value: '2', label: '2 spaces' },
              { value: '4', label: '4 spaces' },
              { value: 'tab', label: 'Tab' },
            ]}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
        {kind === 'url' && dir === 'encode' && (
          <label className="flex items-center gap-2 text-muted-foreground">
            <Switch checked={fullUri} onCheckedChange={setFullUri} aria-label="Keep URL structure" />
            Keep URL structure (<code className="font-mono text-[11px]">encodeURI</code>)
          </label>
        )}
        {kind === 'base64' && dir === 'encode' && (
          <label className="flex items-center gap-2 text-muted-foreground">
            <Switch checked={urlSafe} onCheckedChange={setUrlSafe} aria-label="URL-safe Base64" />
            URL-safe alphabet
          </label>
        )}
        {kind === 'json' && (
          <>
            <label className="flex items-center gap-2 text-muted-foreground">
              <Switch checked={sort} onCheckedChange={setSort} disabled={minify} aria-label="Sort keys" />
              Sort keys
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">
              <Switch checked={minify} onCheckedChange={setMinify} aria-label="Minify" />
              Minify
            </label>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Input" hint={input ? `${input.length.toLocaleString()} chars` : undefined}>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={10}
            autoFocus
            spellCheck={false}
            placeholder={kind === 'json' ? '{"paste":"JSON here"}' : kind === 'url' ? 'https://example.com/search?q=hello world & more' : 'Text or Base64'}
            aria-label="Input"
            className="min-h-48 font-mono text-[13px]"
          />
        </Field>
        <Field
          label={kind === 'json' ? (out.ok && input ? 'Valid JSON ✓' : 'Output') : 'Output'}
          hint={out.ok && out.value ? `${out.value.length.toLocaleString()} chars` : undefined}
        >
          <OutputBox value={out.ok ? out.value : ''} error={out.ok ? null : out.error} className="min-h-48" />
        </Field>
      </div>

      {input && (
        <Button variant="ghost" size="sm" onClick={() => setInput(out.ok ? out.value : input)} disabled={!out.ok || !out.value}>
          Use output as input
        </Button>
      )}
    </div>
  );
}

export default EncodeTool;
