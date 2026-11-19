import { describe, expect, it } from 'vitest';
import { MAX_NODES, type SafeElement, type SafeNode, safeHref, safeImageSrc, sameImage, sanitizeHtml, textOf } from './sanitize';

const BASE = 'https://news.example.com/2026/11/story';
const clean = (html: string, opts: Parameters<typeof sanitizeHtml>[1] = { base: BASE }) => sanitizeHtml(html, opts);

/** Every element in a tree, flattened. */
function all(nodes: readonly SafeNode[]): SafeElement[] {
  return nodes.flatMap((n) => (typeof n === 'string' ? [] : [n, ...all(n.children)]));
}
const tags = (nodes: readonly SafeNode[]) => all(nodes).map((e) => e.tag);
const attrsOf = (nodes: readonly SafeNode[], tag: string) =>
  all(nodes)
    .filter((e) => e.tag === tag)
    .map((e) => e.attrs ?? {});

describe('sanitizeHtml: what is kept', () => {
  it('keeps ordinary article markup', () => {
    const tree = clean(
      '<h2>Heading</h2><p>Some <strong>bold</strong>, <em>italic</em>, <b>b</b>, <i>i</i> and <code>code</code>.</p><ul><li>one</li><li>two</li></ul>' +
        '<ol start="3"><li>three</li></ol><blockquote><p>Quote</p></blockquote><pre><code>let a = 1;\nlet b = 2;</code></pre><hr><p>line<br>break</p>',
    );
    expect(tags(tree)).toEqual(['h2', 'p', 'strong', 'em', 'b', 'i', 'code', 'ul', 'li', 'li', 'ol', 'li', 'blockquote', 'p', 'pre', 'code', 'hr', 'p', 'br']);
    expect(attrsOf(tree, 'ol')[0]).toEqual({ start: 3 });
    expect(textOf(tree)).toContain('let a = 1; let b = 2;');
  });

  it('keeps figures, captions, tables, and maps h5/h6 to h4', () => {
    const tree = clean(
      '<figure><img src="https://img.example.com/a.jpg" alt="A"><figcaption>Caption</figcaption></figure>' +
        '<table><thead><tr><th colspan="2">Head</th></tr></thead><tbody>\n<tr><td>a</td><td rowspan="2">b</td></tr>\n</tbody></table><h5>Small</h5><h6>Smaller</h6>',
    );
    expect(tags(tree)).toEqual(['figure', 'img', 'figcaption', 'table', 'thead', 'tr', 'th', 'tbody', 'tr', 'td', 'td', 'h4', 'h4']);
    expect(attrsOf(tree, 'th')[0]).toEqual({ colSpan: 2 });
    expect(attrsOf(tree, 'td')[1]).toEqual({ rowSpan: 2 });
    // no whitespace-only text between table parts (React would warn about it)
    for (const el of all(tree).filter((e) => ['table', 'tbody', 'tr'].includes(e.tag))) expect(el.children.every((c) => typeof c !== 'string')).toBe(true);
  });

  it('unwraps what it does not know (span, picture, font, custom elements) and keeps the text; div and section become div', () => {
    const tree = clean(
      '<div><section><span class="x">Hello <font color="red">there</font></span><picture><source srcset="https://x.example.com/a.webp"><img src="https://x.example.com/a.jpg"></picture></section><my-widget>custom</my-widget></div>',
    );
    expect(tags(tree)).toEqual(['div', 'div', 'img']);
    expect(textOf(tree)).toBe('Hello there custom');
  });

  it('removes empty elements, but keeps empty table cells', () => {
    const tree = clean('<p></p><p>   </p><div><span></span></div><strong></strong><p>real</p><table><tr><td></td><td>x</td></tr></table>');
    expect(tags(tree)).toEqual(['p', 'table', 'tbody', 'tr', 'td', 'td']); // (the HTML parser adds the implied <tbody>)
  });

  it('adds only the attributes it chose: links get rel and target, pictures get lazy loading and no referrer', () => {
    const tree = clean(
      '<a href="https://example.org/x" title="t" class="c" id="i" style="color:red" data-x="1" onclick="alert(1)">link</a><img src="https://img.example.com/a.jpg" alt="A" width="800" height="450" class="big" style="x" onerror="alert(1)">',
    );
    expect(attrsOf(tree, 'a')[0]).toEqual({ href: 'https://example.org/x', rel: 'noopener noreferrer', target: '_blank' });
    expect(attrsOf(tree, 'img')[0]).toEqual({
      src: 'https://img.example.com/a.jpg',
      alt: 'A',
      loading: 'lazy',
      decoding: 'async',
      referrerPolicy: 'no-referrer',
      width: 800,
      height: 450,
    });
  });

  it('resolves relative links and pictures against the article address, and upgrades http pictures', () => {
    const tree = clean('<a href="/other">rel</a><img src="/img/a.jpg"><img src="http://img.example.com/b.jpg"><img src="//img.example.com/c.jpg">');
    expect(attrsOf(tree, 'a')[0]?.href).toBe('https://news.example.com/other');
    expect(attrsOf(tree, 'img').map((a) => a.src)).toEqual([
      'https://news.example.com/img/a.jpg',
      'https://img.example.com/b.jpg',
      'https://img.example.com/c.jpg',
    ]);
  });

  it('uses the real address of a lazy-loaded picture, and the content of <noscript>', () => {
    const tree = clean(
      '<img src="data:image/gif;base64,R0lGOD" data-src="https://img.example.com/lazy.jpg"><noscript><img src="https://img.example.com/real.jpg"></noscript>',
    );
    expect(attrsOf(tree, 'img').map((a) => a.src)).toEqual(['https://img.example.com/lazy.jpg', 'https://img.example.com/real.jpg']);
  });

  it('leaves out the first appearance of the picture already shown above the text', () => {
    const html =
      '<figure><img src="https://img.example.com/hero.jpg?w=400"></figure><p>text</p><img src="https://img.example.com/hero.jpg"><img src="https://img.example.com/other.jpg">';
    const tree = clean(html, { base: BASE, skipImage: 'https://img.example.com/hero.jpg?w=1200' });
    expect(attrsOf(tree, 'img').map((a) => a.src)).toEqual(['https://img.example.com/hero.jpg', 'https://img.example.com/other.jpg']);
  });

  it('keeps blank, comment-only and unparseable bodies from producing anything', () => {
    expect(clean('')).toEqual([]);
    expect(clean('   \n\t ')).toEqual([]);
    expect(clean('<!-- wp:paragraph --><!-- /wp:paragraph -->')).toEqual([]);
    expect(textOf(clean('<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->'))).toBe('Hi');
  });
});

describe('sanitizeHtml: hostile input', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<SCRIPT SRC=https://evil.example/x.js></SCRIPT>',
    '<style>body{display:none}</style>',
    '<iframe src="https://evil.example"></iframe>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<object data="https://evil.example/x.swf"></object>',
    '<embed src="https://evil.example/x.swf">',
    '<form action="https://evil.example"><input name="pw" type="password"><button>Go</button></form>',
    '<svg onload="alert(1)"><script>alert(2)</script></svg>',
    '<math><mtext><script>alert(1)</script></mtext></math>',
    '<video src="https://evil.example/x.mp4" onerror="alert(1)"></video>',
    '<link rel="stylesheet" href="https://evil.example/x.css"><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/">',
    '<template><script>alert(1)</script></template>',
    '<nav>menu</nav><footer>footer</footer><aside>ad</aside>',
  ];

  it.each(hostile)('drops %s with everything inside it', (html) => {
    const tree = clean(`<p>kept</p>${html}`);
    expect(textOf(tree)).toBe('kept');
    expect(tags(tree)).toEqual(['p']);
  });

  it('never lets a script, handler, style or javascript: URL through, however it is written', () => {
    const attacks = [
      '<img src=x onerror=alert(1)>',
      '<IMG SRC=JaVaScRiPt:alert(1)>',
      '<img src="javascript:alert(1)">',
      '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
      '<a href="javascript:alert(1)">x</a>',
      '<a href="  JaVaScRiPt:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href="java\tscript:alert(1)">x</a>',
      '<a href="vbscript:msgbox(1)">x</a>',
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      '<a href="file:///etc/passwd">x</a>',
      '<div onclick="alert(1)" onmouseover="alert(2)" style="position:fixed;inset:0">x</div>',
      '<p style="background:url(javascript:alert(1))">x</p>',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</p></noscript>',
      '<details open ontoggle="alert(1)"><summary>x</summary></details>',
      '<body onload="alert(1)"><p>x</p></body>',
      '<table background="javascript:alert(1)"><td>x</td></table>',
      '<a href="https://user:pw@evil.example/">x</a>',
    ];
    for (const html of attacks) {
      const tree = clean(html);
      for (const el of all(tree)) {
        for (const [k, v] of Object.entries(el.attrs ?? {})) {
          expect(k, html).not.toMatch(/^on/i);
          expect(k, html).not.toBe('style');
          if (typeof v === 'string') expect(v, html).not.toMatch(/javascript:|vbscript:|data:|file:/i);
        }
        if (el.tag === 'a') expect(el.attrs?.href, html).toMatch(/^https?:\/\//);
        if (el.tag === 'img') expect(el.attrs?.src, html).toMatch(/^https:\/\//);
      }
    }
  });

  it('turns a link it will not follow into its plain text', () => {
    const tree = clean('<p>Click <a href="javascript:alert(1)">here</a> or <a href="https://example.org/ok">there</a></p>');
    expect(textOf(tree)).toBe('Click here or there');
    expect(attrsOf(tree, 'a')).toHaveLength(1);
  });

  it('refuses pictures that point at private networks, internal names, ports, credentials or tracking', () => {
    const srcs = [
      'https://127.0.0.1/a.jpg',
      'https://192.168.1.1/a.jpg',
      'https://10.0.0.1/a.jpg',
      'https://[::1]/a.jpg',
      'https://localhost/a.jpg',
      'https://printer.local/a.jpg',
      'https://intranet/a.jpg',
      'https://example.com:8443/a.jpg',
      'https://user:pw@example.com/a.jpg',
      'https://example.com/pixel.gif',
      'https://stats.example.com/tracking/open.png',
      'https://feeds.feedburner.com/~r/site/~4/abc',
      'https://example.com/undefined',
      'ftp://example.com/a.jpg',
    ];
    for (const src of srcs) expect(clean(`<img src="${src}">`), src).toEqual([]);
  });

  it('removes tracking pixels, spacers and hidden elements', () => {
    const tree = clean(
      '<img src="https://img.example.com/a.gif" width="1" height="1"><img src="https://img.example.com/b.gif" style="width:1px;height:1px">' +
        '<img src="https://img.example.com/c.gif" height="0"><p hidden>secret</p><p style="display: none">secret</p><div style="visibility:hidden">secret</div><p>shown</p>',
    );
    expect(textOf(tree)).toBe('shown');
    expect(tags(tree)).toEqual(['p']);
  });

  it('is not fooled by mutation tricks: it never re-serialises, so nothing can re-form', () => {
    const tree = clean(
      '<p><scr<script>ipt>alert(1)</scr</script>ipt></p><svg><p><style><img src=x onerror=alert(1)></style></p></svg><math><style><img src=x onerror=alert(1)>',
    );
    for (const el of all(tree)) expect(Object.keys(el.attrs ?? {}).some((k) => /^on/i.test(k))).toBe(false);
    expect(tags(tree).filter((t) => (t as string) === 'script' || (t as string) === 'style')).toEqual([]);
  });

  it('bounds the work: deep nesting, huge element counts and huge text', () => {
    const deep = `${'<div>'.repeat(400)}deep${'</div>'.repeat(400)}`;
    expect(() => clean(deep)).not.toThrow();
    expect(textOf(clean(deep))).toContain('deep');

    const many = clean(`<ul>${'<li>x</li>'.repeat(MAX_NODES * 2)}</ul>`);
    expect(all(many).length).toBeLessThanOrEqual(MAX_NODES + 10);

    const bigText = clean(`<p>${'word '.repeat(200_000)}</p>`);
    expect(textOf(bigText).length).toBeLessThanOrEqual(300_000);
  });

  it('survives garbage', () => {
    for (const junk of [
      '<<<<>>>>',
      '<p',
      '<p><',
      '</p></p></div>',
      '\u0000<p>\u0000x',
      '<a href=',
      '<img src="',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
      '<![CDATA[x]]>',
    ]) {
      expect(() => clean(junk), junk).not.toThrow();
    }
    // escaped markup is text, not markup
    expect(textOf(clean('&lt;script&gt;alert(1)&lt;/script&gt;'))).toBe('<script>alert(1)</script>');
    expect(tags(clean('&lt;script&gt;alert(1)&lt;/script&gt;'))).toEqual([]);
  });
});

describe('URL guards', () => {
  it('safeHref accepts http(s) only, without credentials', () => {
    expect(safeHref('https://example.org/a?b=1#c')).toBe('https://example.org/a?b=1#c');
    expect(safeHref('http://example.org/a')).toBe('http://example.org/a');
    expect(safeHref('//example.org/a', 'https://x.example.com/')).toBe('https://example.org/a');
    expect(safeHref('/a', 'https://x.example.com/post')).toBe('https://x.example.com/a');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'mailto:a@b.c',
      'tel:123',
      'ftp://x.example.com/',
      'https://u:p@x.example.com/',
      '',
      '   ',
      'x'.repeat(2500),
    ])
      expect(safeHref(bad, BASE), bad).toBeNull();
    expect(safeHref('/relative')).toBeNull(); // no base to resolve against
    expect(safeHref(null)).toBeNull();
  });

  it('safeImageSrc accepts https on public-looking hosts only', () => {
    expect(safeImageSrc('https://img.example.com/a.jpg?w=1')).toBe('https://img.example.com/a.jpg?w=1');
    expect(safeImageSrc('http://img.example.com/a.jpg')).toBe('https://img.example.com/a.jpg');
    expect(safeImageSrc('https://img.example.com:443/a.jpg')).toBe('https://img.example.com/a.jpg');
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBeNull();
    expect(safeImageSrc('https://2130706433/a.jpg')).toBeNull();
    expect(safeImageSrc(undefined)).toBeNull();
  });

  it('sameImage ignores size parameters', () => {
    expect(sameImage('https://a.example.com/x.jpg?w=1', 'https://a.example.com/x.jpg?w=2')).toBe(true);
    expect(sameImage('https://a.example.com/x.jpg', 'https://a.example.com/y.jpg')).toBe(false);
    expect(sameImage(null, 'https://a.example.com/x.jpg')).toBe(false);
  });
});
