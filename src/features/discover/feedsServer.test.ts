import { describe, expect, it } from 'vitest';
import {
  addressesArePublic,
  applyContentBudget,
  canonicalUrl,
  checkUrl,
  childElements,
  cleanArticleUrl,
  cleanLimit,
  cleanUrls,
  clipHtml,
  decodeEntities,
  detectCharset,
  detectKind,
  firstImage,
  htmlToText,
  httpsUrl,
  isFeedContentType,
  isPrivateIPv4,
  isPrivateIPv6,
  itemId,
  MAX_CONTENT_CHARS,
  MAX_LIMIT,
  MAX_URLS,
  parseDate,
  parseFeed,
  sortNewestFirst,
  stripDangerousHtml,
  upgradeImage,
  xmlText,
} from '../../../supabase/functions/feeds/lib';

const NOW = Date.parse('2026-11-17T16:00:00Z');
const FEED_URL = 'https://example.com/feed.xml';
const parse = (xml: string, url = FEED_URL) => parseFeed(xml, url, NOW);
const item = (xml: string) => parse(`<rss version="2.0"><channel><title>T</title>${xml}</channel></rss>`)?.items ?? [];

// ── fixtures that look like what publishers really send ─────────────────────

const BBC = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title><![CDATA[BBC News]]></title>
    <description><![CDATA[BBC News - News Front Page]]></description>
    <link>https://www.bbc.co.uk/news</link>
    <image><url>https://news.bbcimg.co.uk/nol/shared/img/bbc_news_120x60.gif</url><title>BBC News</title><link>https://www.bbc.co.uk/news</link></image>
    <item>
      <title><![CDATA[Henry Nowak killer applies to appeal against conviction]]></title>
      <description><![CDATA[Vicrum Digwa, who fatally stabbed Nowak in Southampton in 2015, is also seeking a sentence review.]]></description>
      <link>https://www.bbc.co.uk/news/articles/cm93080xj8xgo?at_medium=RSS&amp;at_campaign=rss</link>
      <guid isPermaLink="false">https://www.bbc.co.uk/news/articles/cm93080xj8xgo#0</guid>
      <pubDate>Tue, 17 Nov 2026 15:54:53 GMT</pubDate>
      <media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/ac27/live/51d20e90.jpg"/>
    </item>
    <item>
      <title><![CDATA[How the attack on Putin&#39;s prized Crimean Bridge unfolded]]></title>
      <description><![CDATA[One of the key symbols has suffered major damage.]]></description>
      <link>https://www.bbc.co.uk/news/articles/crz9dgz28zwdo?at_medium=RSS&amp;at_campaign=rss</link>
      <pubDate>Tue, 17 Nov 2026 15:38:10 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const WORDPRESS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>Example Blog &#8211; Ideas</title>
<item>
  <title>Staggering Scroll-Driven Animations &amp; Friends</title>
  <link>https://example.com/staggering/</link>
  <dc:creator><![CDATA[Lee Meyer]]></dc:creator>
  <dc:creator><![CDATA[Ana Ruiz]]></dc:creator>
  <pubDate>Mon, 16 Nov 2026 16:47:05 +0000</pubDate>
  <category><![CDATA[Articles]]></category>
  <category><![CDATA[scroll animations]]></category>
  <category><![CDATA[Articles]]></category>
  <guid isPermaLink="false">https://example.com/?p=395816</guid>
  <description><![CDATA[<p>Imagine a CSS karaoke machine that highlights text as you speak&#8230;</p><p>The post <a href="https://example.com/staggering/">Staggering Scroll-Driven Animations</a> appeared first on <a href="https://example.com">Example Blog</a>.</p>]]></description>
  <content:encoded><![CDATA[<figure><img src="https://example.com/wp-content/uploads/hero.jpg" width="1200" height="630" alt="Hero"></figure><p>${'Words in a sentence that is long enough to matter. '.repeat(30)}</p><p>Second paragraph with <a href="https://example.com/x">a link</a>.</p>]]></content:encoded>
</item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title type="text">The Verge</title>
  <link rel="self" type="application/atom+xml" href="https://www.theverge.com/rss/index.xml"/>
  <updated>2026-11-17T15:35:32-05:00</updated>
  <entry>
    <published>2026-11-17T15:35:32+00:00</published>
    <updated>2026-11-17T15:40:00+00:00</updated>
    <title type="html">Kalshi moves into a new kind of gambling: the stock market</title>
    <link rel="alternate" type="text/html" href="https://www.theverge.com/business/1035366/kalshi-stock-trading"/>
    <link rel="replies" href="https://www.theverge.com/comments/1035366"/>
    <id>https://www.theverge.com/1035366</id>
    <author><name>Emma Roth</name></author>
    <category term="Business"/>
    <category term="News"/>
    <summary type="html">Kalshi is getting ready to offer stock trading on its platform.</summary>
    <content type="html">&lt;figure&gt;&lt;img src=&quot;https://platform.theverge.com/wp-content/uploads/kalshi.jpg&quot; alt=&quot;Kalshi&quot;&gt;&lt;/figure&gt;&lt;p&gt;${'Kalshi is getting ready to offer stock trading. '.repeat(20)}&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>XHTML body</title>
    <link href="https://www.theverge.com/xhtml"/>
    <id>tag:theverge.com,2026:xhtml</id>
    <updated>2026-11-16T10:00:00Z</updated>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>${'Literal markup that is not escaped. '.repeat(15)}</p></div></content>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://rss.dw.com/rdf/rss-en-all"><title>Deutsche Welle</title><link>https://www.dw.com/en/</link></channel>
  <item rdf:about="https://www.dw.com/en/rights-court/a-79972462">
    <title>Rights court rules Turkey must release jailed lawmaker</title>
    <link>https://www.dw.com/en/rights-court/a-79972462?maca=en-rss-en-all-1573-rdf</link>
    <description>The European Court of Human Rights has called for the release of an imprisoned lawmaker.</description>
    <dc:date>2026-11-17T15:47:00Z</dc:date>
    <dc:subject>News</dc:subject>
  </item>
</rdf:RDF>`;

const FEEDBURNER = `<rss version="2.0" xmlns:feedburner="http://rssnamespace.org/feedburner/ext/1.0"><channel><title>Core77</title>
<item><title>A chair</title><link>https://feeds.feedburner.com/~r/core77/blog/~3/abc/chair.html</link><feedburner:origLink>https://www.core77.com/posts/1/a-chair</feedburner:origLink>
<description>&lt;img src="https://feeds.feedburner.com/~r/core77/blog/~4/abc" width="1" height="1"&gt;&lt;img src="https://www.core77.com/img/chair.jpg"&gt; Nice chair.</description>
<pubDate>Tue, 17 Nov 2026 07:50:54 -0500</pubDate></item></channel></rss>`;

const HN = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Hacker News: Front Page</title>
<item><title><![CDATA[A.I. Just Blew Up a Key Tenet of Computer Science]]></title>
<description><![CDATA[ <p>Article URL: <a href="https://www.nytimes.com/2026/11/06/science/x.html">https://www.nytimes.com/2026/11/06/science/x.html</a></p> <p>Comments URL: <a href="https://news.ycombinator.com/item?id=50532786">https://news.ycombinator.com/item?id=50532786</a></p> <p>Points: 11</p> <p># Comments: 4</p> ]]></description>
<pubDate>Tue, 17 Nov 2026 15:33:48 +0000</pubDate><link>https://www.nytimes.com/2026/11/06/science/x.html</link><dc:creator>doener</dc:creator>
<guid isPermaLink="false">https://news.ycombinator.com/item?id=50532786</guid></item></channel></rss>`;

// ── SSRF protection ──────────────────────────────────────────────────────────

describe('feeds: which addresses may be fetched', () => {
  it('accepts ordinary https feed URLs', () => {
    expect(checkUrl('https://feeds.bbci.co.uk/news/rss.xml').ok).toBe(true);
    expect(checkUrl('https://example.com:443/feed').ok).toBe(true);
    expect(checkUrl('https://[2606:4700:4700::1111]/feed').ok).toBe(true);
  });

  it.each([
    ['http://example.com/feed', 'only https'],
    ['ftp://example.com/feed', 'only https'],
    ['javascript:alert(1)', 'only https'],
    ['file:///etc/passwd', 'only https'],
    ['https://user:pw@example.com/feed', 'credentials in URL'],
    ['https://example.com:8443/feed', 'unusual port'],
    ['https://localhost/feed', 'internal hostname'],
    ['https://printer.local/feed', 'internal hostname'],
    ['https://metadata.internal/computeMetadata', 'internal hostname'],
    ['https://intranet/feed', 'internal hostname'],
    ['https://127.0.0.1/feed', 'private address'],
    ['https://10.0.0.5/feed', 'private address'],
    ['https://192.168.1.1/feed', 'private address'],
    ['https://169.254.169.254/latest/meta-data', 'private address'],
    ['https://[::1]/feed', 'private address'],
    ['https://[::ffff:127.0.0.1]/feed', 'private address'],
    ['https://[fd00::1]/feed', 'private address'],
    ['not a url', 'not a URL'],
  ])('refuses %s', (raw, reason) => {
    expect(checkUrl(raw)).toEqual({ ok: false, reason });
  });

  it('sees through the tricks for writing 127.0.0.1', () => {
    for (const raw of ['https://2130706433/', 'https://0x7f.0.0.1/', 'https://0177.0.0.1/', 'https://127.1/', 'https://017700000001/'])
      expect(checkUrl(raw).ok, raw).toBe(false);
  });

  it('classifies IPv4 and IPv6 ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.1',
      '192.168.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      'x',
    ])
      expect(isPrivateIPv4(ip), ip).toBe(true);
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '151.101.1.1']) expect(isPrivateIPv4(ip), ip).toBe(false);
    for (const ip of ['::', '::1', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:10.0.0.1', '2002:7f00:1::', '2001:db8::1', '64:ff9b::7f00:1'])
      expect(isPrivateIPv6(ip), ip).toBe(true);
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false);
  });

  it('after DNS, one private answer is enough to refuse', () => {
    expect(addressesArePublic(['93.184.216.34', '2606:2800:220:1::1'])).toBe(true);
    expect(addressesArePublic(['93.184.216.34', '10.0.0.1'])).toBe(false);
    expect(addressesArePublic([])).toBe(false);
  });

  it('cleans the request: https only, de-duplicated, capped at 12, invalid ones reported', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://example.com/feed${i}`);
    expect(cleanUrls(many).urls).toHaveLength(MAX_URLS);
    const r = cleanUrls(['https://example.com/a#x', 'https://example.com/a', 'http://example.com/b', 'https://127.0.0.1/c', 5, 'x'.repeat(3000)]);
    expect(r.urls).toEqual(['https://example.com/a']);
    expect(r.rejected).toHaveLength(4);
    expect(r.rejected.every((x) => x.reason === 'invalid_url')).toBe(true);
    expect(cleanUrls('https://example.com').urls).toEqual([]);
  });

  it('clamps the limit', () => {
    expect(cleanLimit(undefined)).toBe(20);
    expect(cleanLimit(0)).toBe(1);
    expect(cleanLimit(9999)).toBe(MAX_LIMIT);
    expect(cleanLimit('30')).toBe(20);
    expect(cleanLimit(7.9)).toBe(7);
  });

  it('accepts only XML-ish content types', () => {
    for (const t of ['application/rss+xml; charset=utf-8', 'application/atom+xml', 'text/xml', 'application/xml', 'application/rdf+xml'])
      expect(isFeedContentType(t), t).toBe(true);
    for (const t of ['text/html', 'application/json', 'image/png', 'text/plain', '', null, undefined]) expect(isFeedContentType(t), String(t)).toBe(false);
  });

  it('picks the text encoding from the header, then the XML declaration', () => {
    expect(detectCharset('application/rss+xml; charset=ISO-8859-1', '<?xml version="1.0" encoding="utf-8"?>')).toBe('iso-8859-1');
    expect(detectCharset('text/xml', '<?xml version="1.0" encoding="windows-1252"?><rss>')).toBe('windows-1252');
    expect(detectCharset('text/xml', '<rss>')).toBe('utf-8');
  });
});

// ── parsing real-looking feeds ───────────────────────────────────────────────

describe('feeds: RSS 2.0', () => {
  it('reads a BBC-style feed: CDATA, entities, media:thumbnail, tracking parameters removed', () => {
    const feed = parse(BBC, 'https://feeds.bbci.co.uk/news/rss.xml');
    expect(feed?.title).toBe('BBC News');
    expect(feed?.items).toHaveLength(2);
    const [a, b] = feed?.items ?? [];
    expect(a).toMatchObject({
      title: 'Henry Nowak killer applies to appeal against conviction',
      url: 'https://www.bbc.co.uk/news/articles/cm93080xj8xgo',
      summary: 'Vicrum Digwa, who fatally stabbed Nowak in Southampton in 2015, is also seeking a sentence review.',
      publishedAt: '2026-11-17T15:54:53.000Z',
      contentHtml: '',
      words: 0,
    });
    // the feed lists a 240 px picture; the same file exists at 800 px
    expect(a?.image).toBe('https://ichef.bbci.co.uk/ace/standard/800/cpsprodpb/ac27/live/51d20e90.jpg');
    expect(b?.title).toBe("How the attack on Putin's prized Crimean Bridge unfolded");
    expect(b?.image).toBeNull();
  });

  it('reads a WordPress feed: full content, creators, categories, no "appeared first on" boilerplate', () => {
    const [it0] = parse(WORDPRESS)?.items ?? [];
    expect(it0?.title).toBe('Staggering Scroll-Driven Animations & Friends');
    expect(it0?.author).toBe('Lee Meyer, Ana Ruiz');
    expect(it0?.categories).toEqual(['Articles', 'scroll animations']);
    expect(it0?.summary).toBe('Imagine a CSS karaoke machine that highlights text as you speak…');
    expect(it0?.contentHtml).toContain('<p>Second paragraph with <a href="https://example.com/x">a link</a>.</p>');
    expect(it0?.words).toBeGreaterThan(200);
    expect(it0?.image).toBe('https://example.com/wp-content/uploads/hero.jpg');
    expect(parse(WORDPRESS)?.title).toBe('Example Blog – Ideas');
  });

  it('prefers the original article link over a FeedBurner redirect, and skips 1×1 counters', () => {
    const [it0] = parse(FEEDBURNER)?.items ?? [];
    expect(it0?.url).toBe('https://www.core77.com/posts/1/a-chair');
    expect(it0?.image).toBe('https://www.core77.com/img/chair.jpg');
    expect(it0?.publishedAt).toBe('2026-11-17T12:50:54.000Z');
  });

  it('turns hnrss.org boilerplate into points and comments', () => {
    const [it0] = parse(HN)?.items ?? [];
    expect(it0?.summary).toBe('11 points · 4 comments');
    expect(it0?.url).toBe('https://www.nytimes.com/2026/11/06/science/x.html');
    expect(it0?.author).toBe('doener');
  });

  it('uses a long <description> as the body when there is no content:encoded', () => {
    const body = `<p>${'A long enough sentence to count as an article body. '.repeat(40)}</p>`;
    const [it0] = item(`<item><title>Long</title><link>https://example.com/long</link><description>${body.replace(/</g, '&lt;')}</description></item>`);
    expect(it0?.contentHtml).toContain('A long enough sentence');
    expect(it0?.words).toBeGreaterThan(300);
    expect(it0?.summary.length).toBeLessThanOrEqual(300);
  });

  it('treats a teaser-length content:encoded as no body, but still finds its picture', () => {
    const [it0] = item(
      `<item><title>Teaser</title><link>https://example.com/t</link><description>A teaser.</description><content:encoded><![CDATA[<img src="https://example.com/a.jpg"><p>Just a line.</p>]]></content:encoded></item>`,
    );
    expect(it0?.contentHtml).toBe('');
    expect(it0?.words).toBe(0);
    expect(it0?.image).toBe('https://example.com/a.jpg');
  });

  it('prefers the widest media:content, then thumbnails, then an image enclosure, and ignores video', () => {
    const [a] = item(
      `<item><title>A</title><link>https://example.com/a</link>
       <media:content width="140" url="https://img.example.com/a-140.jpg"/><media:content width="700" url="https://img.example.com/a-700.jpg"/><media:content width="460" url="https://img.example.com/a-460.jpg"/></item>`,
    );
    expect(a?.image).toBe('https://img.example.com/a-700.jpg');
    const [b] = item(
      `<item><title>B</title><link>https://example.com/b</link><media:content url="https://img.example.com/b.mp4" type="video/mp4" medium="video"/>
       <media:thumbnail url="https://img.example.com/b-thumb.jpg" width="300"/></item>`,
    );
    expect(b?.image).toBe('https://img.example.com/b-thumb.jpg');
    const [c] = item(
      `<item><title>C</title><link>https://example.com/c</link><enclosure url="https://img.example.com/c.png" type="image/png" length="1"/></item>`,
    );
    expect(c?.image).toBe('https://img.example.com/c.png');
    const [d] = item(
      `<item><title>D</title><link>https://example.com/d</link><enclosure url="https://cdn.example.com/d.mp3" type="audio/mpeg" length="1"/></item>`,
    );
    expect(d?.image).toBeNull();
    const [e] = item(
      `<item><title>E</title><link>https://example.com/e</link><media:group><media:content url="https://img.example.com/e.jpg" medium="image" width="800"/></media:group></item>`,
    );
    expect(e?.image).toBe('https://img.example.com/e.jpg');
  });

  it('reads a bare <image> on the item (CBS, Healthline)', () => {
    const [a] = item(`<item><title>A</title><link>https://example.com/a</link><image>https://img.example.com/a.jpg</image></item>`);
    expect(a?.image).toBe('https://img.example.com/a.jpg');
  });

  it('cleans author names: emails, "by", HTML', () => {
    expect(item(`<item><title>A</title><link>https://example.com/a</link><author>news@example.com (Jane Roe)</author></item>`)[0]?.author).toBe('Jane Roe');
    expect(item(`<item><title>A</title><link>https://example.com/a</link><author> by <a href="/x">Shrey Shah</a></author></item>`)[0]?.author).toBe(
      'Shrey Shah',
    );
  });

  it('falls back to a permalink guid when there is no <link>, and skips items with no usable link or title', () => {
    const items = item(
      `<item><title>Guid only</title><guid isPermaLink="true">https://example.com/g</guid></item>
       <item><title>No link</title><guid isPermaLink="false">abc</guid></item>
       <item><link>https://example.com/no-title</link></item>`,
    );
    expect(items.map((i) => i.title)).toEqual(['Guid only']);
    expect(items[0]?.url).toBe('https://example.com/g');
  });
});

describe('feeds: Atom and RSS 1.0', () => {
  it('reads Atom: rel=alternate link, author name, term categories, html content, published date', () => {
    const feed = parse(ATOM, 'https://www.theverge.com/rss/index.xml');
    expect(feed?.title).toBe('The Verge');
    const [a, b] = feed?.items ?? [];
    expect(a).toMatchObject({
      title: 'Kalshi moves into a new kind of gambling: the stock market',
      url: 'https://www.theverge.com/business/1035366/kalshi-stock-trading',
      author: 'Emma Roth',
      categories: ['Business', 'News'],
      publishedAt: '2026-11-17T15:35:32.000Z',
      image: 'https://platform.theverge.com/wp-content/uploads/kalshi.jpg',
    });
    expect(a?.summary).toBe('Kalshi is getting ready to offer stock trading on its platform.');
    expect(a?.contentHtml).toContain('<figure><img src="https://platform.theverge.com/wp-content/uploads/kalshi.jpg"');
    // a link without rel is the alternate; an xhtml body is taken literally
    expect(b?.url).toBe('https://www.theverge.com/xhtml');
    expect(b?.contentHtml).toContain('<p>Literal markup that is not escaped.');
    expect(b?.publishedAt).toBe('2026-11-16T10:00:00.000Z');
  });

  it('reads RSS 1.0 (RDF), where items sit beside the channel', () => {
    const feed = parse(RDF, 'https://rss.dw.com/rdf/rss-en-all');
    expect(feed?.title).toBe('Deutsche Welle');
    expect(feed?.items).toHaveLength(1);
    expect(feed?.items[0]).toMatchObject({
      url: 'https://www.dw.com/en/rights-court/a-79972462',
      categories: ['News'],
      publishedAt: '2026-11-17T15:47:00.000Z',
    });
  });

  it('detects the kind of document, and refuses HTML and JSON', () => {
    expect(detectKind(BBC)).toBe('rss');
    expect(detectKind(ATOM)).toBe('atom');
    expect(detectKind(RDF)).toBe('rdf');
    expect(detectKind('<!DOCTYPE html><html><body>hi</body></html>')).toBeNull();
    expect(detectKind('{"items":[]}')).toBeNull();
    expect(detectKind('')).toBeNull();
    expect(detectKind('<?xml version="1.0"?><!-- c --><!DOCTYPE x [<!ENTITY a "b">]><rss version="2.0">')).toBe('rss');
    expect(parse('<!DOCTYPE html><html><head><title>Not a feed</title></head></html>')).toBeNull();
    expect(parse('{"version":"https://jsonfeed.org/version/1.1"}')).toBeNull();
  });

  it('sorts newest first (undated items last, in feed order), de-duplicates, and keeps a BOM harmless', () => {
    const xml = `﻿<rss version="2.0"><channel><title>T</title>
      <item><title>Old</title><link>https://example.com/old</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>Undated</title><link>https://example.com/undated</link></item>
      <item><title>New</title><link>https://example.com/new/</link><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>New again</title><link>https://example.com/new?utm_source=rss</link><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parse(xml)?.items.map((i) => i.title)).toEqual(['New', 'Old', 'Undated']);
  });
});

// ── ids, urls, dates, images ─────────────────────────────────────────────────

describe('feeds: identity and cleaning', () => {
  it('gives the same id to the same article however it is linked', () => {
    const id = itemId('https://example.com/a/b');
    expect(itemId('https://example.com/a/b/')).toBe(id);
    expect(itemId('https://EXAMPLE.com/a/b?utm_source=rss&utm_medium=feed#comments')).toBe(id);
    expect(itemId('https://example.com/a/c')).not.toBe(id);
    expect(id).toMatch(/^[0-9a-z]{6,13}$/);
  });

  it('keeps meaningful query parameters but removes analytics ones', () => {
    expect(cleanArticleUrl('https://example.com/read?id=5&utm_campaign=x&at_medium=RSS&fbclid=zz#top')).toBe('https://example.com/read?id=5');
    expect(canonicalUrl('https://Example.com/p/?id=5&ref=home')).toBe('https://example.com/p?id=5');
    expect(canonicalUrl('not a url')).toBe('not a url');
  });

  it('only returns https URLs on public-looking hosts', () => {
    expect(httpsUrl('http://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(httpsUrl('//cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(httpsUrl('/img/a.jpg', 'https://example.com/post/1')).toBe('https://example.com/img/a.jpg');
    for (const bad of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'ftp://example.com/a',
      'https://127.0.0.1/a.jpg',
      'https://192.168.1.1/a.jpg',
      'https://localhost/a.jpg',
      '',
      'https://x'.padEnd(2100, 'x'),
    ])
      expect(httpsUrl(bad), bad).toBeNull();
    expect(httpsUrl(null)).toBeNull();
  });

  it('parses the date formats feeds use; clamps the future; refuses nonsense', () => {
    expect(parseDate('Tue, 17 Nov 2026 09:37:26 EST', NOW)).toBe('2026-11-17T14:37:26.000Z');
    expect(parseDate('2026-11-17T09:37:26+02:00', NOW)).toBe('2026-11-17T07:37:26.000Z');
    expect(parseDate('Tue, 17 Nov 2026 15:07:06 +0000', NOW)).toBe('2026-11-17T15:07:06.000Z');
    expect(parseDate('2030-01-01T00:00:00Z', NOW)).toBe(new Date(NOW).toISOString());
    expect(parseDate('yesterday-ish', NOW)).toBeNull();
    expect(parseDate('1970-01-01T00:00:00Z', NOW)).toBeNull();
    expect(parseDate('', NOW)).toBeNull();
    expect(parseDate('x'.repeat(100), NOW)).toBeNull();
  });

  it('finds the first real picture in HTML: not data URIs, 1×1 pixels, counters or "undefined"', () => {
    const html = [
      '<img src="data:image/gif;base64,R0lGOD" width="400">',
      '<img src="https://stats.example.com/pixel.gif">',
      '<img src="https://example.com/dot.png" width="1" height="1">',
      '<img src="https://example.com/undefined">',
      '<img data-src="https://example.com/lazy.jpg" src="data:image/gif;base64,R0lGOD">',
      '<img src="https://example.com/second.jpg">',
    ].join('');
    expect(firstImage(html)).toBe('https://example.com/lazy.jpg');
    expect(firstImage('<p>no pictures</p>')).toBeNull();
    expect(firstImage('<img src="/relative.jpg">', 'https://example.com/post')).toBe('https://example.com/relative.jpg');
    expect(firstImage('<image src="https://example.com/x.jpg">')).toBeNull(); // not an <img>
  });

  it('upgrades the thumbnails it knows how to', () => {
    expect(upgradeImage('https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/x/live/a.jpg')).toBe(
      'https://ichef.bbci.co.uk/ace/standard/800/cpsprodpb/x/live/a.jpg',
    );
    expect(upgradeImage('https://npr.brightspotcdn.com/dims3/default/strip/false/crop/3000x2000+0+0/resize/3000x2000!/quality/85/?url=x')).toContain(
      '/resize/1200x800!/',
    );
    expect(upgradeImage('https://npr.brightspotcdn.com/x/resize/800x600!/y')).toContain('/resize/800x600!/');
    expect(upgradeImage('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(upgradeImage(null)).toBeNull();
  });
});

// ── hostile input ────────────────────────────────────────────────────────────

describe('feeds: hostile content', () => {
  it('removes script, style, iframe, object and embed — including the nested-tag evasion', () => {
    const dirty =
      '<p>a</p><script>alert(1)</script><STYLE>body{display:none}</STYLE><iframe src="https://evil.example"></iframe><object data="x"><param name="a"></object>' +
      '<embed src="https://evil.example/x.swf"><p>b</p><scr<script></script>ipt>alert(2)</script><IFRAME src=x />' +
      '<template><img src=x onerror=alert(3)></template><p>c</p>';
    const clean = stripDangerousHtml(dirty);
    expect(clean).not.toMatch(/<\s*\/?\s*(script|style|iframe|object|embed|template)/i);
    expect(clean).not.toContain('alert(');
    expect(clean).toContain('<p>a</p>');
    expect(clean).toContain('<p>b</p>');
    expect(clean).toContain('<p>c</p>');
  });

  it('an unclosed <script> swallows the rest, like a browser would; an unclosed void <embed> does not', () => {
    expect(stripDangerousHtml('<p>keep</p><script>alert(1)<p>gone</p>')).toBe('<p>keep</p>');
    expect(stripDangerousHtml('<p>keep</p><embed src="x"><p>also keep</p>')).toBe('<p>keep</p><p>also keep</p>');
  });

  it('ends up with no script in a parsed item however it is hidden', () => {
    const [it0] = item(
      `<item><title><![CDATA[<script>alert(1)</script>Headline <b>bold</b>]]></title><link>https://example.com/x</link>
       <description><![CDATA[<script>alert(1)</script><p>Summary text that is shown.</p>]]></description>
       <content:encoded><![CDATA[<p>${'Body words go here and there. '.repeat(20)}</p><script>steal()</script><img src=x onerror=alert(1)><iframe src="https://evil.example"></iframe>]]></content:encoded></item>`,
    );
    expect(it0?.title).toBe('Headline bold');
    expect(it0?.summary).toBe('Summary text that is shown.');
    expect(it0?.contentHtml).not.toMatch(/<script|<iframe/i);
    expect(it0?.contentHtml).not.toContain('steal()');
  });

  it('never accepts a javascript:, data: or private-network link or image from a feed', () => {
    expect(item(`<item><title>A</title><link>javascript:alert(1)</link></item>`)).toEqual([]);
    expect(item(`<item><title>A</title><link>https://192.168.0.1/admin</link></item>`)).toEqual([]);
    expect(item(`<item><title>A</title><link>https://localhost/x</link></item>`)).toEqual([]);
    const [a] = item(
      `<item><title>A</title><link>https://example.com/a</link><media:content url="https://169.254.169.254/latest/meta-data" medium="image"/></item>`,
    );
    expect(a?.image).toBeNull();
    const [b] = item(
      `<item><title>B</title><link>https://example.com/b</link><media:content url="javascript:alert(1)" medium="image"/><enclosure url="data:image/png;base64,AAA" type="image/png"/></item>`,
    );
    expect(b?.image).toBeNull();
  });

  it('decodes entities without being fooled: bad code points, bombs, double escapes', () => {
    expect(decodeEntities('&#0;&#xD800;&#1114112;x')).toBe('x');
    expect(decodeEntities('&#99999999999;')).toBe('&#99999999999;'); // too long to be a code point: left alone
    expect(decodeEntities('Tom &amp; Jerry &lt;3 &rsquo;&hellip;&unknown;')).toBe('Tom & Jerry <3 ’…&unknown;');
    expect(decodeEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;'); // one level only
    expect(xmlText('a &amp; b <![CDATA[<b>&amp;</b>]]> &lt;c&gt;')).toBe('a & b <b>&amp;</b> <c>');
    expect(xmlText('<![CDATA[never closed')).toBe('never closed');
  });

  it('turns HTML into text without leaking markup, and keeps a stray "<"', () => {
    expect(htmlToText('<p>One</p><p>Two &amp; <em>three</em></p><br>four')).toBe('One Two & three four');
    expect(htmlToText('1 < 2 and 3 > 2')).toBe('1 < 2 and 3 > 2');
    expect(htmlToText('<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->')).toBe('Hi');
    expect(htmlToText('<p>unterminated <a href="x')).toBe('unterminated <a href="x');
    expect(htmlToText('a'.repeat(5000), 100).length).toBeGreaterThan(0);
  });

  it('survives a feed cut off in the middle of an item: complete items before the cut are kept', () => {
    const full = `<rss version="2.0"><channel><title>T</title>
      <item><title>One</title><link>https://example.com/1</link><description>First</description></item>
      <item><title>Two</title><link>https://example.com/2</link><description>Second</description></item>
      <item><title>Three</title><link>https://example.com/3</link><desc`;
    expect(parse(full)?.items.map((i) => i.title)).toEqual(['One', 'Two']);
    expect(parse('<rss version="2.0"><channel><title>Only a title')).toBeNull();
  });

  it('copes with malformed XML: unclosed tags, stray brackets, attribute soup, CDATA that never ends', () => {
    const items = item(
      `<item><title>Broken <b>markup</title><link>https://example.com/b</link><description><![CDATA[never closed</description></item>
       <item><title a='1' b="2>3" c=4>With attributes</title><link>https://example.com/c</link>
       <description>a < b && c > d</description></item>`,
    );
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((i) => i.url.startsWith('https://'))).toBe(true);
  });

  it('stays fast on pathological input (many unterminated tags, huge repeated markup)', () => {
    const t0 = performance.now();
    const attacks = [
      `<rss><channel><title>x</title>${'<item>'.repeat(20_000)}</channel></rss>`,
      `<rss><channel><title>x</title><item><title>y</title><link>https://example.com/a</link><description>${'<'.repeat(100_000)}</description></item></channel></rss>`,
      `<rss><channel><title>x</title><item><title>y</title><link>https://example.com/a</link><description>${'<a '.repeat(50_000)}</description></item></channel></rss>`,
      `<rss><channel><title>x</title>${'<a>'.repeat(30_000)}<item><title>y</title><link>https://example.com/a</link></item></channel></rss>`,
      `<rss><channel><title>${'&amp;'.repeat(200_000)}</title></channel></rss>`,
      `<rss><channel><title>x</title><item><title>y</title><link>https://example.com/a</link><description>${'<script>'.repeat(30_000)}</description></item></channel></rss>`,
      `<rss><channel><title>x</title><item><title>y</title><link>https://example.com/a</link><description><![CDATA[${'<![CDATA['.repeat(30_000)}</description></item></channel></rss>`,
      `<rss><channel><title>x</title><item ${'a="b" '.repeat(30_000)}><title>y</title></item></channel></rss>`,
    ];
    for (const xml of attacks) parse(xml);
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it('bounds the size of what it returns', () => {
    const huge = `<p>${'word '.repeat(60_000)}</p>`;
    const [it0] = item(
      `<item><title>${'T'.repeat(2000)}</title><link>https://example.com/a</link><description>${'d '.repeat(5000)}</description><content:encoded><![CDATA[${huge}]]></content:encoded>${'<category>c</category>'.repeat(40)}</item>`,
    );
    expect(it0?.title.length).toBeLessThanOrEqual(300);
    expect(it0?.summary.length).toBeLessThanOrEqual(300);
    expect(it0?.contentHtml.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
    expect(it0?.categories.length).toBeLessThanOrEqual(5);
    expect(it0?.words).toBeGreaterThan(50_000);
  });

  it('childElements reads direct children only, with attributes, and skips comments and CDATA', () => {
    const els = childElements(`<!-- <fake>x</fake> --><a href="1">one<b>nested</b></a><c/><d x='y'><![CDATA[</d>]]>tail</d><e>unterminated`);
    expect(els.map((e) => e.name)).toEqual(['a', 'c', 'd']);
    expect(els[0]?.inner).toBe('one<b>nested</b>');
    expect(els[2]?.inner).toBe('<![CDATA[</d>]]>tail');
  });
});

describe('feeds: trimming', () => {
  it('cuts HTML at a block boundary, never inside a tag or entity', () => {
    const html = `${'<p>paragraph of some text</p>'.repeat(3000)}`;
    const cut = clipHtml(html);
    expect(cut.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
    expect(cut.endsWith('</p>')).toBe(true);
    const noBlocks = clipHtml(`${'x'.repeat(39_990)}<a href="https://example.com/very/long/link">link</a>`);
    expect(noBlocks.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
    expect(noBlocks).not.toMatch(/<[^>]*$/);
    expect(clipHtml('<p>short</p>')).toBe('<p>short</p>');
    expect(clipHtml(`${'y'.repeat(39_996)}&amp; more`).endsWith('&amp')).toBe(false);
  });

  it('spends the content budget on the newest items first', () => {
    const mk = (n: number, len: number) => ({
      id: String(n),
      title: String(n),
      url: `https://e.com/${n}`,
      summary: '',
      contentHtml: 'x'.repeat(len),
      image: null,
      author: '',
      publishedAt: null,
      categories: [],
      words: 100,
    });
    const out = applyContentBudget([mk(1, 60), mk(2, 60), mk(3, 0), mk(4, 30)], 100);
    expect(out.map((i) => i.contentHtml.length)).toEqual([60, 0, 0, 30]);
    expect(out[1]?.summary).toBe('');
    expect(sortNewestFirst([])).toEqual([]);
  });
});
