/**
 * An in-memory stand-in for the `feeds` function: realistic-looking (invented) articles for every catalog source, built
 * from the source's topic, with inline-SVG pictures so it works with no network. Used by tests, by the dev harness
 * (`?mock=1`) and by dev builds with no backend configured. Never ships as the default in a real build.
 *
 * Special addresses for exercising the page: `https://example.com/feed.xml` is a small custom feed, `…/hostile.xml` carries
 * hostile markup (to see the reader neutralise it), anything containing "broken" isn't a feed, "slow" answers after 2 s.
 */

import { type DiscoverApi, FeedsError, type MockMode } from './api';
import { CATALOG, type Source, type TopicId } from './catalog';
import type { Article, FeedResult, FeedsResponse } from './types';

const HOUR = 3_600_000;
const PER_SOURCE = 6;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A soft gradient with a few shapes, as a data: URI — no network, any size, deterministic from `seed`. */
export function svgImage(seed: string, w = 1200, h = 675): string {
  const a = hash(seed) % 360;
  const b = (a + 40 + (hash(`${seed}b`) % 80)) % 360;
  const cx = 15 + (hash(`${seed}x`) % 70);
  const cy = 20 + (hash(`${seed}y`) % 60);
  const r = 18 + (hash(`${seed}r`) % 25);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 55% 38%)"/><stop offset="1" stop-color="hsl(${b} 60% 22%)"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="${cx}%" cy="${cy}%" r="${r}%" fill="hsl(${b} 70% 65%)" fill-opacity="0.22"/>` +
    `<circle cx="${100 - cx}%" cy="${100 - cy}%" r="${r * 0.6}%" fill="hsl(${a} 80% 70%)" fill-opacity="0.18"/>` +
    `<path d="M0 ${h * 0.78} C ${w * 0.3} ${h * 0.6}, ${w * 0.6} ${h * 0.95}, ${w} ${h * 0.7} L ${w} ${h} L 0 ${h} Z" fill="hsl(${a} 50% 12%)" fill-opacity="0.35"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const TITLES: Record<TopicId, string[]> = {
  top: [
    'Harbour City council approves a new flood barrier after months of debate',
    'Rail strike talks resume as commuters brace for another week of delays',
    'What the new housing figures say about who can afford to stay',
    'Election observers publish their first assessment of the weekend vote',
    'A town that voted to ban cars in its centre, one year on',
    'The quiet comeback of the neighbourhood library',
    'Winter energy bills: what is changing and what to do about it',
    'Why the heatwave records keep being broken, in five charts',
  ],
  world: [
    'Ceasefire talks stall as both sides trade accusations',
    'Border towns prepare for a second wave of displaced families',
    'Inside the race to rebuild a port city’s power grid',
    'Leaders meet for climate talks with little agreement in sight',
    'A fragile truce holds in the highlands, for now',
    'How a small island nation plans to move its capital',
    'Farmers protest new trade rules across three countries',
    'The refugees turning empty warehouses into schools',
  ],
  tech: [
    'The phone that finally makes repairable hardware cool',
    'Chipmakers brace for a year of tighter supply and bigger bets',
    'A week with a laptop that never needs a fan',
    'Why your smart home keeps forgetting what it learned',
    'The browser feature everyone is quietly copying',
    'Satellite internet is coming to the places cables never reached',
    'Inside the lab teaching batteries to last a decade',
    'Open standards are winning the messaging wars, slowly',
  ],
  ai: [
    'A new model reads a 400-page contract and asks the right question',
    'Researchers show how small models can match large ones on narrow tasks',
    'The case for boring, reliable AI features in everyday apps',
    'How classrooms are rewriting their rules for AI tutors',
    'Open-weight models are closing the gap, and changing the economics',
    'What an AI agent actually does when you leave it running overnight',
    'Evaluating a chatbot: why one number is never enough',
    'The data-labelling workers behind the latest breakthroughs',
  ],
  dev: [
    'Stop writing your own date picker: what the platform gives you now',
    'A practical guide to making your CI pipeline twice as fast',
    'Why we moved a monolith to modules, not microservices',
    'The case for small pull requests, with numbers',
    'Understanding CSS container queries by building a card',
    'What a year of using a typed database client taught us',
    'Debugging memory leaks in long-running Node services',
    'Notes on reading other people’s code without losing a day',
  ],
  science: [
    'Telescope image reveals a nursery of stars hidden in dust',
    'Archaeologists find a 9,000-year-old settlement under a lake',
    'A new material pulls carbon dioxide from damp air',
    'Why some deep-sea fish glow in colours we can barely see',
    'The mathematician who turned a pastime into a proof',
    'Scientists map the weather of an alien world for the first time',
    'Soil microbes may hold the key to cooler, wetter farms',
    'The surprising physics behind the perfect skipping stone',
  ],
  business: [
    'Retailers cut prices early as holiday spending softens',
    'The startup quietly reinventing how small shops get paid',
    'What a four-day week did to one company’s revenue',
    'Why the cost of shipping a container just halved',
    'Interest rates: the decision, the dissent and what happens next',
    'A founder’s guide to your first hire who isn’t a friend',
    'Inside the warehouse that sorts a million parcels a day',
    'The coffee chain betting on smaller, slower stores',
  ],
  design: [
    'A concrete house that folds into its hillside',
    'The typeface designers behind the new transit signs explain their choices',
    'Seven studio chairs that make sitting still a pleasure',
    'How a tiny team rebuilt a design system in a quarter',
    'Colour, contrast and the end of the grey-on-grey interface',
    'A pavilion woven from reclaimed timber and rope',
    'Why good empty states are the most overlooked screens',
    'The return of the paper calendar, redesigned',
  ],
  culture: [
    'The film festival’s surprise favourite is a three-hour silent drama',
    'A debut album that sounds like it was recorded in a stairwell',
    'The novel that turns a village gossip column into a thriller',
    'Why the museum moved its most famous painting into a corridor',
    'Backstage at a theatre that only performs in the dark',
    'The documentary that follows one bus route for a year',
    'A retrospective that finally gives the illustrator her due',
    'Streaming’s quiet revival of the single-camera sitcom',
  ],
  sports: [
    'Late goal sends the title race into a final-day showdown',
    'The rookie who has quietly changed how his team defends',
    'Rain delays, a rescheduled final and a very long Sunday',
    'How a small club built a youth academy that the big ones envy',
    'Marathon organisers announce a flatter, faster course',
    'The coach who wins by never raising her voice',
    'Cricket’s newest format gets its biggest crowd yet',
    'Why every team is suddenly signing a second goalkeeper',
  ],
  health: [
    'A short walk after meals may do more than you think, studies suggest',
    'What the new sleep guidelines actually recommend',
    'Winter vaccines: who should get which, and when',
    'The small habits that doctors say matter most for long-term health',
    'Why more people are asking for a second opinion, and getting one',
    'Mental health apps: what the evidence says so far',
    'How hospitals are shortening waits without hiring more staff',
    'The case for eating the same breakfast every day',
  ],
  gaming: [
    'The indie platformer everyone is calling the surprise of the year',
    'A first look at the console update that finally fixes storage',
    'Why this tiny tactics game has a very big community',
    'Patch notes explained: the balance changes that matter',
    'The studio that spent six years making a game about a lighthouse',
    'Handheld PCs are getting better, and cheaper',
    'Speedrunners find a glitch that breaks a ten-year-old record',
    'What a good tutorial looks like, in five games',
  ],
};

const SUMMARIES = [
  'Officials said the move followed months of consultation, with several groups still calling for changes before it takes effect.',
  'People familiar with the plans say the first results could be published within weeks, though some details are still being worked out.',
  'The findings, which have not yet been peer reviewed, point to a pattern that researchers say deserves a closer look.',
  'It is the latest sign of a wider shift, and one that is already changing how people plan their year.',
  'We spoke to the people closest to it, and looked at the numbers behind the headline.',
  'The answer, it turns out, is less dramatic than it sounds — but more useful than most people expect.',
];

const PARAGRAPHS = [
  'It started, as these things often do, with a small observation. A handful of people noticed the same pattern independently, wrote it down, and compared notes. What looked like a coincidence turned out to be something that had been hiding in plain sight for years.',
  'The people closest to the work are cautious about drawing big conclusions. “We have a good first picture,” one of them said, “but a first picture is not the whole story. We would rather be right in a year than exciting this week.”',
  'There are practical consequences, too. For anyone planning ahead, the sensible response is to prepare for a range of outcomes rather than a single forecast, and to revisit those plans when new figures arrive.',
  'Critics point out that similar promises have been made before. Supporters answer that the circumstances are different this time: the tools are better, the costs are lower, and far more people are paying attention.',
  'None of this is settled. But the direction is clear enough that those affected have begun to adapt, and the early signs from places that moved first are encouraging.',
  'What happens next depends on a few decisions that are still to be made. The next few weeks should show whether the momentum is real or whether this turns out to be one more false start.',
];

/** Realistic-length body HTML: paragraphs, a sub-heading, a list, a quote, one picture. Deterministic from the seed. */
function body(seed: string): { html: string; words: number } {
  const h = hash(seed);
  const p = (i: number) => `<p>${PARAGRAPHS[(h + i) % PARAGRAPHS.length]}</p>`;
  const html = [
    p(0),
    p(1),
    `<figure><img src="https://picsum.photos/seed/${hash(seed) % 1000}/1200/675" alt="A photograph illustrating the story" width="1200" height="675"><figcaption>Photograph: staff</figcaption></figure>`,
    `<h2>What this means</h2>`,
    p(2),
    `<ul><li>The first results are expected within weeks.</li><li>Several groups are asking for changes before it takes effect.</li><li>Those affected are already adapting.</li></ul>`,
    `<blockquote><p>We would rather be right in a year than exciting this week.</p></blockquote>`,
    p(3),
    p(4),
    p(5),
  ].join('\n');
  const words = html
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return { html, words };
}

/** The fixture articles for one source (invented headlines; times are relative to `now`). */
export function fixtureArticles(source: Source, now = Date.now()): Article[] {
  const topic = source.topics[0] ?? 'top';
  const titles = TITLES[topic];
  const start = hash(source.id) % titles.length;
  const out: Article[] = [];
  for (let i = 0; i < PER_SOURCE; i++) {
    const title = titles[(start + i) % titles.length] as string;
    const seed = `${source.id}:${i}`;
    const h = hash(seed);
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 48);
    const url = `${source.site.replace(/\/$/, '')}/articles/${slug}-${source.id}`;
    // Some sources only ship a summary (the "Read the full article" path); the rest carry the whole text.
    const full = h % 3 !== 0 && i < 4;
    const b = full ? body(seed) : null;
    // A few have no picture, like several real feeds.
    const hasImage = !(h % 7 === 0 || source.id === 'hacker-news' || source.id === 'openai');
    out.push({
      id: hash(url).toString(36),
      title: i === 0 && source.id === 'hacker-news' ? `Show HN: ${title}` : title,
      url,
      summary: source.id === 'hacker-news' ? `${20 + (h % 400)} points · ${h % 120} comments` : (SUMMARIES[(h + i) % SUMMARIES.length] as string),
      contentHtml: b?.html ?? '',
      image: hasImage ? svgImage(seed) : null,
      author: ['A. Rivera', 'Sam Okafor', 'Mina Park', 'J. Lindqvist', 'Priya Nair', ''][(h >> 3) % 6] as string,
      publishedAt: new Date(now - ((h % 5) + 1 + i * (2 + (h % 6))) * HOUR - (h % 50) * 60_000).toISOString(),
      categories: [topic],
      words: b?.words ?? 0,
    });
  }
  return out;
}

const HOSTILE_BODY = `
<p>This sample article is full of markup a feed should never be able to use against you.</p>
<script>document.title = 'pwned'; alert('script ran')</script>
<img src="https://picsum.photos/seed/hostile/1200/600" onerror="alert('onerror ran')" alt="A harmless picture" style="width:9999px">
<img src="https://example.com/pixel.gif" width="1" height="1" alt="">
<p><a href="javascript:alert('javascript link ran')">A javascript: link</a> and <a href="https://example.com/real" onclick="alert('click ran')">a normal link</a>.</p>
<iframe src="https://example.com/ad" width="600" height="400"></iframe>
<form action="https://example.com/steal"><input name="password" type="password"><button>Sign in to continue</button></form>
<svg onload="alert('svg ran')"><circle r="50"></circle></svg>
<p style="position:fixed;inset:0;background:red;font-size:80px">Styles from feeds are ignored.</p>
<p>${'Plenty of ordinary words to make this look like a real article body. '.repeat(14)}</p>`;

function exampleFeed(url: string, now: number): FeedResult {
  const hostile = url.includes('hostile');
  const mk = (n: number, title: string, summary: string, html: string): Article => {
    const u = `https://example.com/${hostile ? 'hostile' : 'posts'}/${n}`;
    return {
      id: hash(u).toString(36),
      title,
      url: u,
      summary,
      contentHtml: html,
      image: svgImage(u),
      author: 'Example Author',
      publishedAt: new Date(now - n * 5 * HOUR).toISOString(),
      categories: [],
      words: html
        ? html
            .replace(/<[^>]+>/g, ' ')
            .split(/\s+/)
            .filter(Boolean).length
        : 0,
    };
  };
  return hostile
    ? {
        url,
        title: 'Hostile markup',
        items: [mk(1, 'An article that tries everything', 'Scripts, handlers, forms and trackers — none of it should run.', HOSTILE_BODY)],
      }
    : {
        url,
        title: 'Example Blog',
        items: [
          mk(1, 'Notes from a small corner of the internet', 'A personal blog, added by address.', body('example:1').html),
          mk(2, 'On keeping things small', 'Short posts, no tracking, no feed algorithm.', ''),
          mk(3, 'A reading list for the long weekend', 'Five things worth your time.', body('example:3').html),
        ],
      };
}

export type MemoryApiOptions = { delayMs?: number; now?: () => number; mode?: MockMode };

/** `urls` that are in the catalog get fixtures; the special example addresses (see the top of this file) behave as described; anything else isn't found. */
export function memoryDiscoverApi(opts: MemoryApiOptions = {}): DiscoverApi {
  const delay = opts.delayMs ?? 280;
  const clock = opts.now ?? Date.now;
  const byFeed = new Map(CATALOG.map((s) => [s.feed, s]));
  return {
    async fetchFeeds(urls, o) {
      const now = clock();
      const limit = Math.min(Math.max(o?.limit ?? 20, 1), 50);
      const slow = opts.mode === 'slow' || urls.some((u) => u.includes('slow'));
      if (delay || slow) await new Promise((r) => setTimeout(r, slow ? 2500 : delay));
      if (opts.mode === 'offline') throw new FeedsError('offline');
      if (opts.mode === 'error') throw new FeedsError('unavailable');
      if (opts.mode === 'empty') return { feeds: [], failed: urls.map((url) => ({ url, reason: 'empty' })) };
      const response: FeedsResponse = { feeds: [], failed: [] };
      for (const url of urls.slice(0, 12)) {
        const source = byFeed.get(url);
        if (source) {
          response.feeds.push({ url, title: source.name, items: fixtureArticles(source, now).slice(0, limit) });
        } else if (url.includes('broken')) {
          response.failed.push({ url, reason: 'not_a_feed' });
        } else if (url.startsWith('https://example.com/')) {
          response.feeds.push(exampleFeed(url, now));
        } else {
          response.failed.push({ url, reason: 'not_found' });
        }
      }
      return response;
    },
  };
}
