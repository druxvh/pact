/**
 * The pure half of the first-run tour: which steps there are, where a card goes relative to what it points at, and when
 * the tour starts by itself. No React and no stores in here, so every rule is unit-tested.
 */

/** `full` is the signed-in tour; `guest` is the shorter one for people who can only see Home. */
export type TourKind = 'full' | 'guest';

export type Side = 'top' | 'bottom' | 'left' | 'right';

export type TourStep = {
  id: string;
  /** The `data-tour="…"` value of the element to spotlight. `null` = a centred card with nothing behind it. */
  target: string | null;
  title: string;
  body: string;
  /** Which side of the target the card prefers (it flips if there's no room). */
  side: Side;
  /** Shortcuts shown under the text. */
  keys?: ReadonlyArray<{ keys: readonly string[]; label: string }>;
};

export type TourContext = {
  /** `⌘` on a Mac, `Ctrl` elsewhere. */
  mod: string;
  /** The toolbar shortcut for quick capture, one label per key. */
  captureKeys: readonly string[];
};

export function tourSteps(kind: TourKind, { mod, captureKeys }: TourContext): TourStep[] {
  const capture: TourStep = {
    id: 'capture',
    target: null,
    side: 'bottom',
    title: 'Capture a thought in a second',
    body:
      kind === 'guest'
        ? 'Press C here, or click the pact button in your browser’s toolbar from any tab, and a small sheet opens. Without an account it saves to Home’s Quick note.'
        : `Press C anywhere in pact, or use the pact button in your toolbar from any tab. A small sheet opens: type, press ${mod}↵, and it’s saved as a note or a task.`,
    keys: [
      { keys: ['C'], label: 'Inside pact' },
      { keys: captureKeys, label: 'From any tab' },
    ],
  };

  if (kind === 'guest') {
    return [
      {
        id: 'palette',
        target: 'palette',
        side: 'bottom',
        title: 'Search or jump anywhere',
        body: 'Type a web address or a search into the big box on Home. Press the shortcut below for the command palette, which jumps between pages.',
        keys: [
          { keys: [mod, 'K'], label: 'Command palette' },
          { keys: ['/'], label: 'Search on Home' },
        ],
      },
      capture,
      {
        id: 'sections',
        target: 'sections',
        side: 'right',
        title: 'There’s more behind a sign-in',
        body: 'Notes, Kanban, Focus, Tools, Chat and VibeParty need a free account, so your stuff follows you from device to device. Home works without one.',
      },
      {
        id: 'sign-in',
        target: 'sign-in',
        side: 'bottom',
        title: 'Sign in when you’re ready',
        body: 'Use GitHub or Google. There’s no password to remember, and nothing changes about Home.',
      },
    ];
  }

  return [
    {
      id: 'sections',
      target: 'sections',
      side: 'right',
      title: 'Your pages live here',
      body: 'Notes, Kanban, Focus, Tools, Chat and VibeParty are one click away. Prefer the keyboard? Press G, then the first letter of a page.',
      keys: [
        { keys: ['G', 'N'], label: 'Notes' },
        { keys: ['G', 'K'], label: 'Kanban' },
      ],
    },
    {
      id: 'palette',
      target: 'palette',
      side: 'bottom',
      title: 'Search or jump anywhere',
      body: 'The command palette finds your notes, tasks and chats, jumps between pages and creates new things. On Home, the big search box also understands web addresses.',
      keys: [
        { keys: [mod, 'K'], label: 'Command palette' },
        { keys: ['/'], label: 'Search on Home' },
      ],
    },
    capture,
    {
      id: 'focus',
      target: 'nav-timer',
      side: 'right',
      title: 'A timer that keeps going',
      body: 'The Focus timer keeps running when you close the tab and lets you know when a session ends. Set a main focus for the day on Home, then start a session from it.',
      keys: [{ keys: ['G', 'T'], label: 'Open Focus' }],
    },
    {
      id: 'settings',
      target: 'nav-settings',
      side: 'right',
      title: 'Make it yours',
      body: 'Pick an accent colour, a font and a wallpaper, choose a Home layout and its widgets. You can replay this tour from Settings → About whenever you like.',
      keys: [{ keys: ['G', 'S'], label: 'Open Settings' }],
    },
  ];
}

// ── placement ────────────────────────────────────────────────────────────────

export type Box = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Placement = { top: number; left: number; side: Side | 'center' };

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const PERPENDICULAR: Record<Side, [Side, Side]> = { top: ['right', 'left'], bottom: ['right', 'left'], left: ['bottom', 'top'], right: ['bottom', 'top'] };

/** Whether a measured element is really on screen — hidden (`display: none`) elements measure as 0 × 0, and a scrolled-away one lies outside. */
export function isUsable(box: Box | null, viewport: Size): box is Box {
  return (
    box !== null &&
    box.width > 0 &&
    box.height > 0 &&
    box.top + box.height > 0 &&
    box.left + box.width > 0 &&
    box.top < viewport.height &&
    box.left < viewport.width
  );
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, Math.max(min, max)));

/**
 * Where a card of `card` size goes next to `anchor`. Tries the preferred side, then the opposite one, then the other two;
 * the first that fits entirely on screen wins and the card is slid along that edge to stay inside the viewport. If none
 * fits (a very small window, a huge target) — or there is no anchor — the card is centred.
 */
export function placeCard(anchor: Box | null, card: Size, viewport: Size, prefer: Side, gap = 14, margin = 12): Placement {
  const center: Placement = {
    top: clamp((viewport.height - card.height) / 2, margin, viewport.height - card.height - margin),
    left: clamp((viewport.width - card.width) / 2, margin, viewport.width - card.width - margin),
    side: 'center',
  };
  if (!isUsable(anchor, viewport)) return center;

  const room: Record<Side, number> = {
    top: anchor.top - margin,
    bottom: viewport.height - (anchor.top + anchor.height) - margin,
    left: anchor.left - margin,
    right: viewport.width - (anchor.left + anchor.width) - margin,
  };
  const fits = (side: Side) => room[side] >= (side === 'top' || side === 'bottom' ? card.height : card.width) + gap;
  const side = [prefer, OPPOSITE[prefer], ...PERPENDICULAR[prefer]].find(fits);
  if (!side) return center;

  const midX = anchor.left + anchor.width / 2;
  const midY = anchor.top + anchor.height / 2;
  const alongX = clamp(midX - card.width / 2, margin, viewport.width - card.width - margin);
  const alongY = clamp(midY - card.height / 2, margin, viewport.height - card.height - margin);
  switch (side) {
    case 'top':
      return { top: anchor.top - gap - card.height, left: alongX, side };
    case 'bottom':
      return { top: anchor.top + anchor.height + gap, left: alongX, side };
    case 'left':
      return { top: alongY, left: anchor.left - gap - card.width, side };
    case 'right':
      return { top: alongY, left: anchor.left + anchor.width + gap, side };
  }
}

/** The cut-out around a target: a little breathing room, but never outside the screen. */
export function spotlightBox(anchor: Box, viewport: Size, pad = 6): Box {
  const top = Math.max(0, anchor.top - pad);
  const left = Math.max(0, anchor.left - pad);
  const bottom = Math.min(viewport.height, anchor.top + anchor.height + pad);
  const right = Math.min(viewport.width, anchor.left + anchor.width + pad);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

// ── when to start ────────────────────────────────────────────────────────────

export type AutoStartInput = {
  auth: 'loading' | 'guest' | 'signedIn';
  /** The account's profile has been loaded, so `onboarded` can be trusted (it may have been set on another device). */
  profileReady: boolean;
  onboarded: boolean;
  /** The welcome flow just finished and asked for the tour. */
  requested: boolean;
  completed: Record<TourKind, boolean>;
  /** Something else (a dialog, the palette) is open — wait for a calm moment. */
  blocked: boolean;
};

export type AutoStart = 'start-guest' | 'start-full' | 'mark-full-seen' | 'wait' | 'none';

/**
 * The tour never runs twice and never ambushes someone who was here before it existed:
 *  - a guest gets the short tour once (unless they've already seen or skipped it);
 *  - a signed-in person gets the full tour only when the welcome flow hands it over. Anyone already onboarded without that
 *    hand-off (an existing user after an update, or a new device for an old account) is quietly marked as having seen it.
 */
export function decideAutoStart(i: AutoStartInput): AutoStart {
  if (i.auth === 'loading') return 'wait';
  if (i.auth === 'guest') {
    if (i.completed.guest) return 'none';
    return i.blocked ? 'wait' : 'start-guest';
  }
  if (!i.profileReady) return 'wait';
  if (i.completed.full) return 'none';
  if (!i.onboarded) return 'wait';
  if (!i.requested) return 'mark-full-seen';
  return i.blocked ? 'wait' : 'start-full';
}

/** True when nothing pact has ever stored is on this device — i.e. this is the first time it has opened. */
export function looksLikeFreshInstall(keys: Iterable<string>, ownKey: string): boolean {
  for (const k of keys) if (k.startsWith('pact-') && k !== ownKey) return false;
  return true;
}
