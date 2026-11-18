/**
 * Social links on a profile: at most five, on known platforms, https only. The database enforces the same rules
 * (`private.valid_links`, migration 20261119000000), so what passes here is what the server accepts — and this is also what
 * every place that *shows* a link runs it through, because a profile is somebody else's input.
 */

export type SocialKind =
  | 'instagram'
  | 'facebook'
  | 'x'
  | 'snapchat'
  | 'pinterest'
  | 'linkedin'
  | 'github'
  | 'youtube'
  | 'tiktok'
  | 'threads'
  | 'reddit'
  | 'twitch'
  | 'discord'
  | 'telegram'
  | 'website';

export type SocialLink = { kind: SocialKind; url: string };

export const MAX_LINKS = 5;
const MAX_URL = 200;

type Platform = { label: string; host: RegExp; handle?: (h: string) => string; placeholder: string };
const sub = '(?:[a-z0-9-]+\\.)?';

export const PLATFORMS: Record<SocialKind, Platform> = {
  instagram: {
    label: 'Instagram',
    host: new RegExp(`^${sub}instagram\\.com$`),
    handle: (h) => `https://instagram.com/${h}`,
    placeholder: 'username or instagram.com/…',
  },
  facebook: {
    label: 'Facebook',
    host: new RegExp(`^${sub}(?:facebook\\.com|fb\\.com|fb\\.me)$`),
    handle: (h) => `https://facebook.com/${h}`,
    placeholder: 'username or facebook.com/…',
  },
  x: { label: 'X', host: new RegExp(`^${sub}(?:x\\.com|twitter\\.com)$`), handle: (h) => `https://x.com/${h}`, placeholder: '@handle or x.com/…' },
  snapchat: {
    label: 'Snapchat',
    host: new RegExp(`^${sub}snapchat\\.com$`),
    handle: (h) => `https://snapchat.com/add/${h}`,
    placeholder: 'username or snapchat.com/add/…',
  },
  pinterest: {
    label: 'Pinterest',
    host: new RegExp(`^${sub}(?:pinterest\\.[a-z.]{2,}|pin\\.it)$`),
    handle: (h) => `https://pinterest.com/${h}`,
    placeholder: 'username or pinterest.com/…',
  },
  linkedin: {
    label: 'LinkedIn',
    host: new RegExp(`^${sub}linkedin\\.com$`),
    handle: (h) => `https://linkedin.com/in/${h}`,
    placeholder: 'username or linkedin.com/in/…',
  },
  github: { label: 'GitHub', host: new RegExp(`^${sub}github\\.com$`), handle: (h) => `https://github.com/${h}`, placeholder: 'username or github.com/…' },
  youtube: {
    label: 'YouTube',
    host: new RegExp(`^${sub}(?:youtube\\.com|youtu\\.be)$`),
    handle: (h) => `https://youtube.com/@${h}`,
    placeholder: '@channel or youtube.com/…',
  },
  tiktok: { label: 'TikTok', host: new RegExp(`^${sub}tiktok\\.com$`), handle: (h) => `https://tiktok.com/@${h}`, placeholder: '@handle or tiktok.com/@…' },
  threads: {
    label: 'Threads',
    host: new RegExp(`^${sub}threads\\.(?:net|com)$`),
    handle: (h) => `https://threads.net/@${h}`,
    placeholder: '@handle or threads.net/@…',
  },
  reddit: {
    label: 'Reddit',
    host: new RegExp(`^${sub}reddit\\.com$`),
    handle: (h) => `https://reddit.com/user/${h}`,
    placeholder: 'username or reddit.com/user/…',
  },
  twitch: { label: 'Twitch', host: new RegExp(`^${sub}twitch\\.tv$`), handle: (h) => `https://twitch.tv/${h}`, placeholder: 'channel or twitch.tv/…' },
  discord: { label: 'Discord', host: new RegExp(`^${sub}(?:discord\\.gg|discord\\.com)$`), placeholder: 'invite link, discord.gg/…' },
  telegram: { label: 'Telegram', host: new RegExp(`^${sub}(?:t\\.me|telegram\\.me)$`), handle: (h) => `https://t.me/${h}`, placeholder: 'username or t.me/…' },
  website: { label: 'Website', host: /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/, placeholder: 'https://your-site.com' },
};

export const SOCIAL_KINDS = Object.keys(PLATFORMS) as SocialKind[];
export const isSocialKind = (v: unknown): v is SocialKind => typeof v === 'string' && v in PLATFORMS;

const HANDLE = /^[A-Za-z0-9._-]{1,40}$/;

/** Does this text start with the platform's own web address (as in `instagram.com` or `instagram.com/alice`)? */
function namesHost(p: Platform, text: string): boolean {
  try {
    return p.host.test(new URL(`https://${text}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export type LinkResult = { ok: true; url: string } | { ok: false; error: string };

/** Turn what someone typed (a handle, "instagram.com/x", a full https address) into the address we store — or say what's wrong. */
export function normalizeLink(kind: SocialKind, input: string): LinkResult {
  const p = PLATFORMS[kind];
  let raw = input.trim();
  if (!raw) return { ok: false, error: 'Enter a link or username' };
  if (/^@/.test(raw)) raw = raw.slice(1);
  // "sam.okafor" is an Instagram name (dots are allowed in them), "instagram.com" is an address: tell them apart by whether it names the platform's own host.
  if (p.handle && HANDLE.test(raw) && !namesHost(p, raw)) raw = p.handle(raw);
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'That doesn’t look like a link' };
  }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') return { ok: false, error: 'Links must start with https://' };
  if (u.username || u.password) return { ok: false, error: 'Links can’t contain a password' };
  if (u.port && u.port !== '443') return { ok: false, error: 'Unusual ports aren’t allowed' };
  u.port = '';
  u.hash = '';
  if (!p.host.test(u.hostname.toLowerCase())) return { ok: false, error: kind === 'website' ? 'Enter a valid web address' : `That link isn’t from ${p.label}` };
  const url = u.toString();
  if (url.length > MAX_URL) return { ok: false, error: 'That link is too long' };
  return { ok: true, url };
}

/** Anything read from storage or from another person's profile: keep only valid links, no duplicates, at most five. */
export function sanitizeLinks(input: unknown): SocialLink[] {
  if (!Array.isArray(input)) return [];
  const out: SocialLink[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (out.length >= MAX_LINKS) break;
    if (typeof item !== 'object' || item === null) continue;
    const { kind, url } = item as { kind?: unknown; url?: unknown };
    if (!isSocialKind(kind) || typeof url !== 'string') continue;
    const r = normalizeLink(kind, url);
    if (!r.ok || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push({ kind, url: r.url });
  }
  return out;
}

/** "@alice" for a profile link when the path says so, otherwise the host — a short label for a chip or tooltip. */
export function linkLabel(link: SocialLink): string {
  try {
    const u = new URL(link.url);
    const first = u.pathname.split('/').filter(Boolean).pop() ?? '';
    if (link.kind !== 'website' && first && first.length <= 30) return first.startsWith('@') ? first : `@${first}`;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return PLATFORMS[link.kind].label;
  }
}
