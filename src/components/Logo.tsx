import { motion } from 'motion/react';
import { cn } from '@/lib/cn';

/**
 * The pact "p." mark. Same geometry as public/icon.svg; the dot hops on hover.
 * Painted from the live accent tokens, so it re-themes with the accent and with light/dark (ink is `--brand-foreground`,
 * which is already chosen for contrast on the accent). The tab icon follows the same rule — see lib/appearance/favicon.ts.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      initial="rest"
      whileHover="hover"
      className={cn('size-9 shrink-0 drop-shadow-[0_4px_12px_var(--brand-glow)]', className)}
    >
      <defs>
        <linearGradient id="pact-logo-bg" x1="22" y1="4" x2="106" y2="124" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'color-mix(in oklab, var(--brand), white 18%)' }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in oklab, var(--brand), black 12%)' }} />
        </linearGradient>
        <linearGradient id="pact-logo-gloss" x1="64" y1="0" x2="64" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="30" fill="url(#pact-logo-bg)" />
      <rect width="128" height="128" rx="30" fill="url(#pact-logo-gloss)" />
      <g transform="translate(-6 -3)" className="stroke-brand-foreground" strokeLinecap="round">
        <path d="M48 97V41" strokeWidth="15" />
        <circle cx="68" cy="59" r="20" strokeWidth="15" />
      </g>
      <motion.circle
        cx="92"
        cy="92"
        r="8"
        className="fill-brand-foreground"
        variants={{
          rest: { y: 0 },
          hover: { y: [0, -18, 0, -6, 0], transition: { duration: 0.7, ease: 'easeOut' } },
        }}
      />
    </motion.svg>
  );
}
