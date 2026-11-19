/**
 * Where a picture comes from. Shown in Settings → About whichever style is on (CC BY asks for the credit wherever the work is used).
 * Add an entry for every new image that is made from someone else's work.
 */
export type ArtCredit = {
  id: string;
  /** What the picture is. */
  subject: string;
  /** The Wikimedia Commons file name. */
  file: string;
  creator: string;
  licence: string;
  /** Link to the licence text (not for the public domain). */
  licenceUrl?: string;
  /** The file's page on Wikimedia Commons. */
  sourceUrl: string;
  /** What was done to it. CC BY requires saying so. */
  changes: string;
};

/**
 * The Ultramarine style's own pictures — none: its plates (the empty states, the sign-in gate, the welcome form) are drawn in code by
 * `plates.ts`, not made from a photograph. The wallpaper's bust is credited in `features/stylewall/credits.ts`; Settings → About lists both.
 */
export const ART_CREDITS: readonly ArtCredit[] = [];
