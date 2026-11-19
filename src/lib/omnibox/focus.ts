/**
 * ⌘K (Ctrl+K elsewhere) always means "take me to the omnibox".
 *
 * On **Home** the omnibox *is* the big search box, so the shortcut focuses it (selecting what is in it, so typing
 * replaces it, and opening its dropdown). On every other page the same engine and UI appear as the overlay palette.
 * Pressing it again while the overlay is open closes it.
 *
 * The Home box registers itself here while it is mounted (`registerHomeOmnibox`); the shell's hotkey and the top-bar
 * search button call `summonOmnibox`. Which of the three things happens is decided by the pure `omniboxIntent`.
 */

/** What the mounted Home box lends to the rest of the app. */
export type HomeOmnibox = { focus: () => void };

// A stack, so the most recent registration wins (React StrictMode mounts twice in dev; two boxes never coexist in the app).
const homeBoxes: HomeOmnibox[] = [];

/** Called by the Home box while it is mounted. Returns the function that unregisters it. */
export function registerHomeOmnibox(box: HomeOmnibox): () => void {
  homeBoxes.push(box);
  return () => {
    const at = homeBoxes.lastIndexOf(box);
    if (at >= 0) homeBoxes.splice(at, 1);
  };
}

/** Is a Home box on screen to receive focus? (It is not when the layout hides search, or on another page.) */
export const hasHomeOmnibox = (): boolean => homeBoxes.length > 0;

/** Focus the Home box (selecting its text, opening its dropdown). `false` when there is none. */
export function focusHomeOmnibox(): boolean {
  const box = homeBoxes[homeBoxes.length - 1];
  if (!box) return false;
  box.focus();
  return true;
}

export type OmniboxIntent = 'focus-home' | 'open-palette' | 'close-palette';

export type OmniboxState = {
  paletteOpen: boolean;
  /** The current page (`useNavStore().section`). */
  section: string;
  /** Is the Home box registered (mounted and visible)? */
  homeBox: boolean;
  /** Another dialog (welcome flow, shortcuts, sign-in…) is open: focusing a box behind it would be pointless. */
  modalOpen: boolean;
};

/** What ⌘K does, given where the user is. */
export function omniboxIntent(s: OmniboxState): OmniboxIntent {
  if (s.paletteOpen) return 'close-palette';
  if (s.section === 'home' && s.homeBox && !s.modalOpen) return 'focus-home';
  return 'open-palette';
}

/** What the shell lends so this module never imports a store. */
export type OmniboxHost = {
  state: () => Pick<OmniboxState, 'paletteOpen' | 'section' | 'modalOpen'>;
  setPaletteOpen: (open: boolean) => void;
};

/**
 * Carry out the intent. `toggle: false` (a click on the search button) leaves an open palette alone instead of closing it.
 * Returns what happened, or `null` when nothing did.
 */
export function summonOmnibox(host: OmniboxHost, { toggle = true }: { toggle?: boolean } = {}): OmniboxIntent | null {
  const intent = omniboxIntent({ ...host.state(), homeBox: hasHomeOmnibox() });
  if (intent === 'close-palette') {
    if (!toggle) return null;
    host.setPaletteOpen(false);
    return intent;
  }
  if (intent === 'focus-home' && focusHomeOmnibox()) return intent;
  host.setPaletteOpen(true);
  return 'open-palette';
}

/* ───────────────────────────── focusing the Home box on load ───────────────────────────── */

/** Is a dialog open (the first-run welcome, the tour, a sheet)? Focus must never be pulled out from under it. */
export const modalIsOpen = (doc: Document = document): boolean => doc.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

/** Nothing meaningful holds focus (the page body does) and no dialog is open. */
export function canTakeFocus(active: Element | null, doc: Document = document): boolean {
  if (modalIsOpen(doc)) return false;
  return !active || active === doc.body || active === doc.documentElement;
}

/** Milliseconds after mount at which focus is tried: the page is still settling (hydration, the page transition, the browser moving focus around). */
export const AUTOFOCUS_AT: readonly number[] = [0, 60, 200, 500, 1200, 2500];

/**
 * Focus `el` once the page is up — and keep politely trying for a couple of seconds, because browsers often hand focus
 * to their own address bar around a new tab opening (and give the page focus later). It stops as soon as the element has
 * focus, or the person clicks or types anywhere, and it skips any attempt while something else (a dialog, another field)
 * holds focus. Also retries when the window gains focus or the tab becomes visible. Returns a cleanup function.
 */
export function startAutoFocus(el: HTMLElement): () => void {
  const doc = el.ownerDocument;
  const win = doc.defaultView ?? window;
  let stopped = false;
  let interacted = false;
  const timers: number[] = [];

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const t of timers) win.clearTimeout(t);
    doc.removeEventListener('pointerdown', onInteract, true);
    doc.removeEventListener('keydown', onInteract, true);
    doc.removeEventListener('visibilitychange', attempt);
    win.removeEventListener('focus', attempt);
  };
  const attempt = () => {
    if (stopped) return;
    if (doc.activeElement === el) return stop();
    if (interacted || doc.visibilityState === 'hidden' || !canTakeFocus(doc.activeElement, doc)) return;
    el.focus({ preventScroll: true });
    if (doc.activeElement === el) stop();
  };
  const onInteract = () => {
    interacted = true;
  };

  doc.addEventListener('pointerdown', onInteract, true);
  doc.addEventListener('keydown', onInteract, true);
  doc.addEventListener('visibilitychange', attempt);
  win.addEventListener('focus', attempt);
  for (const ms of AUTOFOCUS_AT) timers.push(win.setTimeout(attempt, ms));
  timers.push(win.setTimeout(stop, (AUTOFOCUS_AT[AUTOFOCUS_AT.length - 1] ?? 0) + 100));
  return stop;
}
