import type { TopicId } from './catalog';

/** One article exactly as the `feeds` Edge Function returns it (see supabase/functions/feeds/lib.ts). */
export type Article = {
  /** Stable hash of the article's address — the same article has the same id in every feed that carries it. */
  id: string;
  title: string;
  url: string;
  /** Plain text, ≤ 300 characters. */
  summary: string;
  /** Raw HTML from the feed, or '' when the feed only carries a summary. UNTRUSTED: only ever shown through `sanitize.ts`. */
  contentHtml: string;
  image: string | null;
  author: string;
  publishedAt: string | null;
  categories: string[];
  /** Word count of the full text (0 = the feed only has a summary). */
  words: number;
};

export type FeedResult = { url: string; title: string; items: Article[] };
export type FeedFailure = { url: string; reason: string };
export type FeedsResponse = { feeds: FeedResult[]; failed: FeedFailure[] };

/** Where an article came from. */
export type SourceRef = { id: string; name: string; site: string };

/** An article together with its source — what the page lists. */
export type Entry = Article & { source: SourceRef; feedUrl: string };

/** What is kept for a saved article: everything but the (large, untrusted) body and the feed it was in. */
export type SavedArticle = Omit<Article, 'contentHtml'> & { source: SourceRef; savedAt: string };

export type CustomFeed = { id: string; url: string; name: string; addedAt: string };

/** A feed the page can load: a catalog source or one the person added. */
export type FeedRef = { id: string; name: string; site: string; url: string; language: string; custom: boolean };

export type Density = 'grid' | 'list';
/** What the page is showing: the personal mix, one topic, or the reading list. */
export type View = 'foryou' | 'saved' | TopicId;
