import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Where the bundled policy page lives (an extension page, so it works offline). */
export const PRIVACY_PAGE = '/privacy.html';

/** A link to the privacy policy, for places that mention data (the sign-in card, Settings). Opens in a new tab. */
export function PrivacyLink({ className, children = 'Privacy policy' }: { className?: string; children?: ReactNode }) {
  return (
    <a href={PRIVACY_PAGE} target="_blank" rel="noopener noreferrer" className={cn('rounded-sm underline underline-offset-4 hover:text-foreground', className)}>
      {children}
    </a>
  );
}
