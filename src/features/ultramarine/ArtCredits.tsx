import { STYLEWALL_CREDITS } from '@/features/stylewall/credits';
import { ART_CREDITS } from '@/features/ultramarine/credits';

const link = 'text-brand-text underline decoration-brand-text/40 underline-offset-2 hover:decoration-current';

/** Settings → About: who made the pictures, under which licence, and what was changed. Always shown, whichever style is on. */
export function ArtCredits() {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {[...ART_CREDITS, ...STYLEWALL_CREDITS].map((c) => (
        <li key={c.id}>
          {c.subject} — “
          <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className={link}>
            {c.file}
          </a>
          ” by {c.creator},{' '}
          {c.licenceUrl ? (
            <a href={c.licenceUrl} target="_blank" rel="noopener noreferrer" className={link}>
              {c.licence}
            </a>
          ) : (
            c.licence.toLowerCase()
          )}
          , via Wikimedia Commons. {c.changes}
        </li>
      ))}
    </ul>
  );
}
