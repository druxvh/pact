import { Globe, Link2 } from 'lucide-react';
import {
  siDiscord,
  siFacebook,
  siGithub,
  siInstagram,
  siPinterest,
  siReddit,
  siSnapchat,
  siTelegram,
  siThreads,
  siTiktok,
  siTwitch,
  siX,
  siYoutube,
} from 'simple-icons';
import { cn } from '@/lib/cn';
import type { SocialKind } from '@/lib/socialLinks';

// (LinkedIn's mark isn't in simple-icons any more; this is its standard 24×24 "in" glyph.)
const LINKEDIN =
  'M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z';

const PATHS: Partial<Record<SocialKind, string>> = {
  instagram: siInstagram.path,
  facebook: siFacebook.path,
  x: siX.path,
  snapchat: siSnapchat.path,
  pinterest: siPinterest.path,
  linkedin: LINKEDIN,
  github: siGithub.path,
  youtube: siYoutube.path,
  tiktok: siTiktok.path,
  threads: siThreads.path,
  reddit: siReddit.path,
  twitch: siTwitch.path,
  discord: siDiscord.path,
  telegram: siTelegram.path,
};

/** The platform's mark, in the current text colour. */
export function SocialIcon({ kind, className }: { kind: SocialKind; className?: string }) {
  const d = PATHS[kind];
  if (!d)
    return kind === 'website' ? (
      <Globe aria-hidden="true" className={cn('size-4', className)} />
    ) : (
      <Link2 aria-hidden="true" className={cn('size-4', className)} />
    );
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={cn('size-4', className)}>
      <path d={d} />
    </svg>
  );
}
