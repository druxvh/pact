/**
 * The built-in sources. Every feed URL here was fetched (HTTP 200, valid RSS/Atom/RDF, items present, parsed by the same
 * parser the `feeds` function uses) on 2026-11-17; dead or blocked feeds (NYT-style paywalled aggregators that answered 403,
 * Vulture, Economist, New Scientist, HBR, WebMD…) were dropped rather than shipped. Order matters: inside a topic, the first
 * sources are the ones "following a topic" pulls in (see `sourcesForTopic`).
 */

export type TopicId = 'top' | 'tech' | 'ai' | 'dev' | 'science' | 'world' | 'business' | 'design' | 'culture' | 'sports' | 'health' | 'gaming';

export type Topic = { id: TopicId; label: string };

export const TOPICS: readonly Topic[] = [
  { id: 'top', label: 'Top stories' },
  { id: 'tech', label: 'Technology' },
  { id: 'ai', label: 'AI' },
  { id: 'dev', label: 'Developer' },
  { id: 'science', label: 'Science' },
  { id: 'world', label: 'World' },
  { id: 'business', label: 'Business' },
  { id: 'design', label: 'Design' },
  { id: 'culture', label: 'Culture & Entertainment' },
  { id: 'sports', label: 'Sports' },
  { id: 'health', label: 'Health' },
  { id: 'gaming', label: 'Gaming' },
];

export const TOPIC_IDS: readonly TopicId[] = TOPICS.map((t) => t.id);
export const TOPIC_BY_ID = Object.fromEntries(TOPICS.map((t) => [t.id, t])) as Record<TopicId, Topic>;
export const isTopicId = (v: unknown): v is TopicId => typeof v === 'string' && (TOPIC_IDS as readonly string[]).includes(v);

export type Source = {
  id: string;
  name: string;
  /** The publication's home page. */
  site: string;
  /** The RSS / Atom feed, always https. */
  feed: string;
  topics: readonly TopicId[];
  /** BCP 47 language of the articles. */
  language: string;
};

const s = (id: string, name: string, site: string, feed: string, topics: TopicId[], language = 'en'): Source => ({ id, name, site, feed, topics, language });

export const CATALOG: readonly Source[] = [
  // Top stories
  s('bbc-news', 'BBC News', 'https://www.bbc.com/news', 'https://feeds.bbci.co.uk/news/rss.xml', ['top', 'world']),
  s('npr-news', 'NPR News', 'https://www.npr.org/sections/news/', 'https://feeds.npr.org/1001/rss.xml', ['top']),
  s('the-guardian', 'The Guardian', 'https://www.theguardian.com/international', 'https://www.theguardian.com/international/rss', ['top', 'world']),
  s('nyt', 'The New York Times', 'https://www.nytimes.com', 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', ['top']),
  s('pbs-newshour', 'PBS NewsHour', 'https://www.pbs.org/newshour', 'https://www.pbs.org/newshour/feeds/rss/headlines', ['top', 'world']),

  // World
  s('al-jazeera', 'Al Jazeera', 'https://www.aljazeera.com', 'https://www.aljazeera.com/xml/rss/all.xml', ['world']),
  s('france-24', 'France 24', 'https://www.france24.com/en/', 'https://www.france24.com/en/rss', ['world']),
  s('dw', 'Deutsche Welle', 'https://www.dw.com/en/', 'https://rss.dw.com/rdf/rss-en-all', ['world']),
  s('rest-of-world', 'Rest of World', 'https://restofworld.org', 'https://restofworld.org/feed/latest', ['world', 'tech']),

  // Technology
  s('the-verge', 'The Verge', 'https://www.theverge.com', 'https://www.theverge.com/rss/index.xml', ['tech']),
  s('ars-technica', 'Ars Technica', 'https://arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/index', ['tech', 'science']),
  s('wired', 'WIRED', 'https://www.wired.com', 'https://www.wired.com/feed/rss', ['tech']),
  s('techcrunch', 'TechCrunch', 'https://techcrunch.com', 'https://techcrunch.com/feed/', ['tech', 'business']),
  s('engadget', 'Engadget', 'https://www.engadget.com', 'https://www.engadget.com/rss.xml', ['tech']),
  s('mit-tech-review', 'MIT Technology Review', 'https://www.technologyreview.com', 'https://www.technologyreview.com/feed/', ['tech', 'ai']),
  s('hacker-news', 'Hacker News', 'https://news.ycombinator.com', 'https://hnrss.org/frontpage', ['tech', 'dev']),

  // AI
  s('openai', 'OpenAI', 'https://openai.com/news/', 'https://openai.com/news/rss.xml', ['ai']),
  s('google-deepmind', 'Google DeepMind', 'https://deepmind.google/blog/', 'https://deepmind.google/blog/rss.xml', ['ai', 'science']),
  s('google-ai', 'Google AI', 'https://blog.google/technology/ai/', 'https://blog.google/innovation-and-ai/technology/ai/rss/', ['ai']),
  s('hugging-face', 'Hugging Face', 'https://huggingface.co/blog', 'https://huggingface.co/blog/feed.xml', ['ai', 'dev']),
  s('import-ai', 'Import AI', 'https://importai.substack.com', 'https://importai.substack.com/feed', ['ai']),
  s('simon-willison', 'Simon Willison', 'https://simonwillison.net', 'https://simonwillison.net/atom/everything/', ['ai', 'dev']),

  // Developer
  s('dev-to', 'DEV Community', 'https://dev.to', 'https://dev.to/feed', ['dev']),
  s('css-tricks', 'CSS-Tricks', 'https://css-tricks.com', 'https://css-tricks.com/feed/', ['dev', 'design']),
  s('smashing', 'Smashing Magazine', 'https://www.smashingmagazine.com', 'https://www.smashingmagazine.com/feed/', ['dev', 'design']),
  s('github-blog', 'The GitHub Blog', 'https://github.blog', 'https://github.blog/feed/', ['dev']),
  s('cloudflare-blog', 'Cloudflare Blog', 'https://blog.cloudflare.com', 'https://blog.cloudflare.com/rss/', ['dev']),
  s('martin-fowler', 'Martin Fowler', 'https://martinfowler.com', 'https://martinfowler.com/feed.atom', ['dev']),

  // Science
  s('nasa', 'NASA', 'https://www.nasa.gov', 'https://www.nasa.gov/feed/', ['science']),
  s('quanta', 'Quanta Magazine', 'https://www.quantamagazine.org', 'https://www.quantamagazine.org/feed/', ['science']),
  s('science-news', 'Science News', 'https://www.sciencenews.org', 'https://www.sciencenews.org/feed', ['science']),
  s('space-com', 'Space.com', 'https://www.space.com', 'https://www.space.com/feeds.xml', ['science']),
  s('live-science', 'Live Science', 'https://www.livescience.com', 'https://www.livescience.com/feeds.xml', ['science']),
  s('phys-org', 'Phys.org', 'https://phys.org', 'https://phys.org/rss-feed/', ['science']),

  // Business
  s('cnbc', 'CNBC', 'https://www.cnbc.com', 'https://www.cnbc.com/id/100003114/device/rss/rss.html', ['business']),
  s('fast-company', 'Fast Company', 'https://www.fastcompany.com', 'https://www.fastcompany.com/latest/rss', ['business', 'design']),
  s('forbes', 'Forbes', 'https://www.forbes.com/business/', 'https://www.forbes.com/business/feed/', ['business']),
  s('business-insider', 'Business Insider', 'https://www.businessinsider.com', 'https://feeds.businessinsider.com/custom/all', ['business']),

  // Design
  s('dezeen', 'Dezeen', 'https://www.dezeen.com', 'https://www.dezeen.com/feed/', ['design']),
  s('designboom', 'designboom', 'https://www.designboom.com', 'https://www.designboom.com/feed/', ['design']),
  s('creative-bloq', 'Creative Bloq', 'https://www.creativebloq.com', 'https://www.creativebloq.com/feeds.xml', ['design']),
  s('a-list-apart', 'A List Apart', 'https://alistapart.com', 'https://alistapart.com/main/feed/', ['design', 'dev']),
  s('ux-collective', 'UX Collective', 'https://uxdesign.cc', 'https://uxdesign.cc/feed', ['design']),

  // Culture & Entertainment
  s('pitchfork', 'Pitchfork', 'https://pitchfork.com', 'https://pitchfork.com/feed/feed-news/rss', ['culture']),
  s('variety', 'Variety', 'https://variety.com', 'https://variety.com/feed/', ['culture']),
  s('consequence', 'Consequence', 'https://consequence.net', 'https://consequence.net/feed/', ['culture']),
  s('atlas-obscura', 'Atlas Obscura', 'https://www.atlasobscura.com', 'https://www.atlasobscura.com/feeds/latest', ['culture']),
  s('the-new-yorker', 'The New Yorker', 'https://www.newyorker.com', 'https://www.newyorker.com/feed/everything', ['culture', 'top']),
  s('the-marginalian', 'The Marginalian', 'https://www.themarginalian.org', 'https://www.themarginalian.org/feed/', ['culture']),

  // Sports
  s('espn', 'ESPN', 'https://www.espn.com', 'https://www.espn.com/espn/rss/news', ['sports']),
  s('bbc-sport', 'BBC Sport', 'https://www.bbc.com/sport', 'https://feeds.bbci.co.uk/sport/rss.xml', ['sports']),
  s('guardian-sport', 'The Guardian · Sport', 'https://www.theguardian.com/sport', 'https://www.theguardian.com/uk/sport/rss', ['sports']),
  s('sky-sports', 'Sky Sports', 'https://www.skysports.com', 'https://www.skysports.com/rss/12040', ['sports']),
  s('cricinfo', 'ESPNcricinfo', 'https://www.espncricinfo.com', 'https://www.cricinfo.com/rss/content/story/feeds/0.xml', ['sports']),

  // Health
  s('bbc-health', 'BBC Health', 'https://www.bbc.com/news/health', 'https://feeds.bbci.co.uk/news/health/rss.xml', ['health']),
  s('npr-health', 'NPR Health', 'https://www.npr.org/sections/health/', 'https://feeds.npr.org/1128/rss.xml', ['health']),
  s('stat-news', 'STAT', 'https://www.statnews.com', 'https://www.statnews.com/feed/', ['health', 'science']),
  s('kff-health-news', 'KFF Health News', 'https://kffhealthnews.org', 'https://kffhealthnews.org/feed/', ['health']),
  s('medical-xpress', 'Medical Xpress', 'https://medicalxpress.com', 'https://medicalxpress.com/rss-feed/', ['health', 'science']),

  // Gaming
  s('polygon', 'Polygon', 'https://www.polygon.com', 'https://www.polygon.com/feed/', ['gaming']),
  s('kotaku', 'Kotaku', 'https://kotaku.com', 'https://kotaku.com/feed', ['gaming']),
  s('ign', 'IGN', 'https://www.ign.com', 'https://feeds.feedburner.com/ign/all', ['gaming']),
  s('pc-gamer', 'PC Gamer', 'https://www.pcgamer.com', 'https://www.pcgamer.com/rss/', ['gaming']),
  s('rock-paper-shotgun', 'Rock Paper Shotgun', 'https://www.rockpapershotgun.com', 'https://www.rockpapershotgun.com/feed', ['gaming']),
  s('nintendo-life', 'Nintendo Life', 'https://www.nintendolife.com', 'https://www.nintendolife.com/feeds/latest', ['gaming']),

  // In other languages (never part of a topic's default sources — people add them on purpose)
  s('bbc-mundo', 'BBC Mundo', 'https://www.bbc.com/mundo', 'https://feeds.bbci.co.uk/mundo/rss.xml', ['top', 'world'], 'es'),
  s('le-monde', 'Le Monde', 'https://www.lemonde.fr', 'https://www.lemonde.fr/rss/une.xml', ['top', 'world'], 'fr'),
  s('tagesschau', 'tagesschau', 'https://www.tagesschau.de', 'https://www.tagesschau.de/index~rss2.xml', ['top', 'world'], 'de'),
];

export const SOURCE_BY_ID: Readonly<Record<string, Source>> = Object.fromEntries(CATALOG.map((x) => [x.id, x]));

/** What a new account follows: a spread across topics, so "For you" is a real front page from the first visit (10 sources = one request). */
export const STARTER_SOURCES: readonly string[] = [
  'bbc-news',
  'npr-news',
  'the-guardian',
  'the-verge',
  'ars-technica',
  'wired',
  'hacker-news',
  'nasa',
  'quanta',
  'polygon',
];

/** How many sources following a topic brings into "For you" (the first ones of that topic in the catalog). */
export const TOPIC_FOLLOW_SOURCES = 4;

/** The English-language sources of a topic, in catalog order. A source in another language only shows up once it is followed on its own. */
export function sourcesForTopic(topic: TopicId): Source[] {
  return CATALOG.filter((x) => x.topics.includes(topic) && x.language === 'en');
}
