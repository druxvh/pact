import type { SocialLink } from '@/lib/socialLinks';

/**
 * Sample social links for the demo friends, so their hover cards look like real ones (placeholder handles, https, on the right
 * hosts — a test checks that each one passes `sanitizeLinks`). A `Person`'s own `links` win; these only fill in when a demo
 * record has none. Keyed by person id.
 */
export const DEMO_LINKS: Record<string, SocialLink[]> = {
  alex: [
    { kind: 'instagram', url: 'https://instagram.com/pact_demo_alex' },
    { kind: 'x', url: 'https://x.com/pact_demo_alex' },
    { kind: 'website', url: 'https://alex-rivera.example/' },
  ],
  jordan: [
    { kind: 'linkedin', url: 'https://linkedin.com/in/pact-demo-jordan' },
    { kind: 'x', url: 'https://x.com/pact_demo_jordan' },
  ],
  sam: [
    { kind: 'github', url: 'https://github.com/pact-demo-sam' },
    { kind: 'youtube', url: 'https://youtube.com/@pact_demo_sam' },
    { kind: 'website', url: 'https://sam-okafor.example/' },
    { kind: 'discord', url: 'https://discord.gg/pactdemo' },
  ],
  riley: [
    { kind: 'instagram', url: 'https://instagram.com/pact_demo_riley' },
    { kind: 'threads', url: 'https://threads.net/@pact_demo_riley' },
    { kind: 'website', url: 'https://riley-chen.example/' },
  ],
};
