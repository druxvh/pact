/**
 * Real brand marks for well-known sites, bundled (Simple Icons, CC0) — so shortcuts look right instantly and
 * offline, with no favicon service and no network request. Anything not listed falls back to the browser's own
 * favicon cache (inside the extension) and finally to a neutral monogram.
 *
 * Matching is by hostname, never by substring, so `evil-github.com` and `mail.google.com.evil.example` don't
 * pick up somebody else's logo.
 */
import {
  type SimpleIcon,
  siAirbnb,
  siAirtable,
  siAnthropic,
  siApple,
  siAsana,
  siAtlassian,
  siBehance,
  siBitbucket,
  siBluesky,
  siCloudflare,
  siCoursera,
  siDiscord,
  siDocker,
  siDribbble,
  siDropbox,
  siDuckduckgo,
  siDuolingo,
  siEbay,
  siEvernote,
  siFacebook,
  siFigma,
  siFirebase,
  siGithub,
  siGitlab,
  siGmail,
  siGoogle,
  siGooglecalendar,
  siGooglechrome,
  siGoogledocs,
  siGoogledrive,
  siGooglegemini,
  siGooglemaps,
  siGooglemeet,
  siGooglenews,
  siGooglephotos,
  siGooglesheets,
  siHuggingface,
  siImdb,
  siInstagram,
  siJira,
  siLinear,
  siMastodon,
  siMedium,
  siMiro,
  siNetflix,
  siNetlify,
  siNotion,
  siNpm,
  siObsidian,
  siPaypal,
  siPerplexity,
  siPinterest,
  siPostman,
  siProton,
  siQuora,
  siReddit,
  siReplit,
  siShopify,
  siSoundcloud,
  siSpotify,
  siStackoverflow,
  siSteam,
  siStripe,
  siSubstack,
  siSupabase,
  siTelegram,
  siThreads,
  siTiktok,
  siTodoist,
  siTrello,
  siTumblr,
  siTwitch,
  siUdemy,
  siVercel,
  siVimeo,
  siWhatsapp,
  siWikipedia,
  siX,
  siYcombinator,
  siYoutube,
  siYoutubemusic,
  siZoom,
} from 'simple-icons';

export type Brand = { title: string; path: string; hex: string };

/** [icon, hostnames it owns]. A hostname owns its subdomains too, unless a more specific entry claims them. */
const ENTRIES: Array<[SimpleIcon, string[]]> = [
  [siYoutube, ['youtube.com', 'youtu.be']],
  [siYoutubemusic, ['music.youtube.com']],
  [siGithub, ['github.com', 'gist.github.com']],
  [siGitlab, ['gitlab.com']],
  [siBitbucket, ['bitbucket.org']],
  [siGmail, ['mail.google.com', 'gmail.com']],
  [siGooglecalendar, ['calendar.google.com']],
  [siGoogledrive, ['drive.google.com']],
  [siGoogledocs, ['docs.google.com']],
  [siGooglesheets, ['sheets.google.com']],
  [siGooglemeet, ['meet.google.com']],
  [siGooglemaps, ['maps.google.com']],
  [siGooglephotos, ['photos.google.com']],
  [siGooglenews, ['news.google.com']],
  [siGooglegemini, ['gemini.google.com']],
  [siGooglechrome, ['chromewebstore.google.com', 'chrome.google.com']],
  [siGoogle, ['google.com']],
  [siNotion, ['notion.so', 'notion.com']],
  [siFigma, ['figma.com']],
  [siLinear, ['linear.app']],
  [siJira, ['jira.com']],
  [siAtlassian, ['atlassian.com', 'atlassian.net']],
  [siTrello, ['trello.com']],
  [siAsana, ['asana.com']],
  [siAirtable, ['airtable.com']],
  [siMiro, ['miro.com']],
  [siTodoist, ['todoist.com']],
  [siEvernote, ['evernote.com']],
  [siObsidian, ['obsidian.md']],
  [siX, ['x.com', 'twitter.com']],
  [siReddit, ['reddit.com', 'redd.it']],
  [siFacebook, ['facebook.com', 'fb.com']],
  [siInstagram, ['instagram.com']],
  [siThreads, ['threads.net', 'threads.com']],
  [siBluesky, ['bsky.app']],
  [siMastodon, ['mastodon.social']],
  [siTiktok, ['tiktok.com']],
  [siPinterest, ['pinterest.com']],
  [siTumblr, ['tumblr.com']],
  [siQuora, ['quora.com']],
  [siMedium, ['medium.com']],
  [siSubstack, ['substack.com']],
  [siYcombinator, ['news.ycombinator.com', 'ycombinator.com']],
  [siDiscord, ['discord.com', 'discord.gg']],
  [siTelegram, ['telegram.org', 't.me', 'web.telegram.org']],
  [siWhatsapp, ['whatsapp.com', 'web.whatsapp.com']],
  [siZoom, ['zoom.us']],
  [siSpotify, ['spotify.com']],
  [siNetflix, ['netflix.com']],
  [siTwitch, ['twitch.tv']],
  [siVimeo, ['vimeo.com']],
  [siSoundcloud, ['soundcloud.com']],
  [siImdb, ['imdb.com']],
  [siSteam, ['steampowered.com', 'steamcommunity.com']],
  [siStackoverflow, ['stackoverflow.com']],
  [siNpm, ['npmjs.com']],
  [siVercel, ['vercel.com']],
  [siNetlify, ['netlify.com']],
  [siCloudflare, ['cloudflare.com']],
  [siSupabase, ['supabase.com']],
  [siFirebase, ['firebase.google.com']],
  [siDocker, ['docker.com', 'hub.docker.com']],
  [siPostman, ['postman.com']],
  [siReplit, ['replit.com']],
  [siHuggingface, ['huggingface.co']],
  [siAnthropic, ['anthropic.com', 'claude.ai']],
  [siPerplexity, ['perplexity.ai']],
  [siDribbble, ['dribbble.com']],
  [siBehance, ['behance.net']],
  [siUdemy, ['udemy.com']],
  [siCoursera, ['coursera.org']],
  [siDuolingo, ['duolingo.com']],
  [siWikipedia, ['wikipedia.org']],
  [siDuckduckgo, ['duckduckgo.com']],
  [siProton, ['proton.me']],
  [siPaypal, ['paypal.com']],
  [siStripe, ['stripe.com']],
  [siShopify, ['shopify.com']],
  [siEbay, ['ebay.com']],
  [siAirbnb, ['airbnb.com']],
  [siApple, ['apple.com']],
  [siDropbox, ['dropbox.com']],
];

const BY_HOST = new Map<string, Brand>();
for (const [icon, hosts] of ENTRIES) for (const h of hosts) BY_HOST.set(h, { title: icon.title, path: icon.path, hex: `#${icon.hex}` });

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The brand for a URL, or null. Exact hostname first, then walk up parent domains (`a.b.github.com` → `github.com`). */
export function brandFor(url: string): Brand | null {
  const host = hostOf(url);
  if (!host) return null;
  const parts = host.split('.');
  for (let i = 0; i <= parts.length - 2; i++) {
    const hit = BY_HOST.get(parts.slice(i).join('.'));
    if (hit) return hit;
  }
  return null;
}

/** Perceived lightness 0–1 of a #rrggbb colour (used to pick a legible glyph colour). */
export function hexLightness(hex: string): number {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
