# pact

A new-tab extension for **teams, classes and friends**: notes, a kanban board, a focus timer, tiny private tools, chat — and a *watch YouTube together* mode — on the page you already open a hundred times a day.

Local-first, no accounts, no tracking. Built with WXT, React 19, Tailwind v4, Base UI and Motion.

## What's real and what's a demo

| Area | State |
| --- | --- |
| Home, Notes, Kanban, Focus, Tools, Settings | **Real.** Stored on your device (browser local storage). Nothing is uploaded and nothing syncs between devices. Export/import a backup from Settings. |
| VibeParty (watch together) | **Real.** Works between YouTube tabs in one browser out of the box. Add the bundled relay to watch with friends on other computers. |
| Chat & friends | **A working UI over a simulated backend.** pact has no server for people yet, so friends are bots that reply, show typing indicators and "accept" requests. All of that lives in one file — `src/store/demoServer.ts` — so swapping in a real realtime backend doesn't touch any view. |

## Quick start

```bash
bun install
bun run dev        # WXT opens a dev browser with the extension loaded, with hot reload
```

To load a production build by hand: `bun run build`, then open `chrome://extensions`, enable *Developer mode*, *Load unpacked* → `.output/chrome-mv3`.

Requires Bun 1.x and a Chromium browser (Chrome 116+). A Firefox build exists too — see [Browsers](#browsers).

| Script | What it does |
| --- | --- |
| `bun run dev` / `dev:firefox` | Dev browser with hot reload |
| `bun run build` / `build:firefox` | Production bundle in `.output/` |
| `bun run zip` / `zip:firefox` | Store-ready archive |
| `bun run check` | Typecheck (TypeScript 7) + Biome + tests — run before committing |
| `bun run test` / `test:watch` | Vitest |
| `bun run lint` / `lint:fix` | Biome |
| `bun run relay` | Start the VibeParty relay (see below) |

## What's inside

| Page | Highlights | Go there |
| --- | --- | --- |
| **Home** | Search box that understands URLs, brand-icon shortcuts (add, edit, undo-remove), your most-visited sites, a choice of clocks and optional widgets (see below) | `g h` |
| **Notes** | Notebooks, Markdown editor with live preview, tick checkboxes in the preview, autosave, pins, undo | `g n` |
| **Kanban** | Drag-and-drop with live reordering, priorities, due dates, task details, filters, progress | `g k` |
| **Focus** | Pomodoro that survives navigation and closed tabs (alarms + notification), session history and streaks | `g t` |
| **Tools** | Calculator, unit converter, colour + contrast, text tools, encoders, password generator, QR codes, image compressor (≤ 5 MB), random picker — all on-device | `g o` |
| **Chat** | DMs and groups, replies, reactions, emoji picker, image/video attachments (stored in IndexedDB), link-safe rendering | `g c` |
| **VibeParty** | Synced YouTube playback, chat, reactions and a shared up-vote queue | `g p` |
| **Settings** | Profile, theme, accent colour, fonts, wallpapers, Home layouts and widgets, animations, backup & restore | `g s` |

Everywhere: `⌘K` / `Ctrl+K` command palette (jump, create, search notes/tasks/chats), `?` for every shortcut, `pact <page>` in the address bar. Light and dark themes, reduced-motion support, keyboard-first.

## Make it yours

Everything below lives in **Settings → Appearance / Home** and is stored on your device.

**Appearance**
- **Accent colour** — 16 presets or any colour you pick. One choice re-themes every button, highlight, focus ring and brand-coloured text in both light and dark. The colour is adjusted (not rejected) so text stays at WCAG AA contrast; the stock orange adds no overrides at all.
- **Fonts** — 33 free families: 23 sans-serif (Geist, Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Nunito, DM Sans, Manrope, Plus Jakarta Sans, Outfit, Work Sans, Source Sans 3, Raleway, Space Grotesk, Sora, Figtree, Rubik, IBM Plex Sans, Lexend, Bricolage Grotesque, Instrument Sans), 4 serif (Playfair Display, Merriweather, Lora, Source Serif 4) and 6 monospace for code and numbers (Geist Mono, JetBrains Mono, Fira Code, Source Code Pro, Roboto Mono, IBM Plex Mono), plus your system fonts. All are bundled via Fontsource (Latin subset) and loaded only when you use them — still no network requests.
- **Wallpaper** — solid colours, gradients (presets or your own two colours and angle), mesh gradients, or your own image (downscaled to WebP and kept in IndexedDB). Cards turn into frosted glass over a wallpaper. A **Dim** layer is set per theme, and pact picks the smallest dim that keeps even muted text readable (4.5:1) and tells you when a wallpaper can't be made legible.

**Home**
- **Layouts** — Classic, Minimal, Dashboard, Zen and Focus. Change anything and it becomes *Custom*.
- **Clock** — digital, compact, analog or none; seconds, date and greeting are independent switches; 12h/24h/auto.
- **Show or hide** the search box, keyboard hints and shortcuts.
- **Widgets** (reorderable): *Today* (overdue / due-today / in-progress tasks — tick them off or add one), *Focus* (minutes today and streak), *Pinned notes*, *Quick note* (saves as a real note), *Quote of the day* (bundled, no network) and *Countdown* to a date you choose. They only read what's already in pact — there's deliberately no weather or news widget, since that would need a network request.

## Accounts and cloud sync (Supabase)

pact works as a **guest** with no account: Home with search, shortcuts (your local bookmarks) and recent/most-visited sites. Everything else needs sign-in with **GitHub, Google or an emailed one-time code** (no password).

- **Notes** sync to your account, local-first: they're instant and work offline, upload in the background, and appear live on your other devices (Realtime). Conflicts are last-write-wins; deletions sync. A small cloud icon in the top bar shows whether everything is saved.
- Tasks, timer history, chat and settings still live on this device for now (they're hidden from guests, and a *different* account signing in on the same browser never inherits them).
- Security: Row Level Security on every table (you can only ever read your own rows), only the publishable key ships in the extension, PKCE sign-in through `chrome.identity`. The schema is in `supabase/migrations/`.

**Setup**
1. Apply `supabase/migrations/20261116000000_profiles_and_notes.sql` to your project (SQL editor, or the Supabase CLI / MCP).
2. Authentication → Providers: enable **GitHub** and **Google** (callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`).
3. **Email code sign-in:** enabled by default, but edit the *Magic Link* and *Confirm signup* email templates (Authentication → Email Templates) so they contain `{{ .Token }}` (e.g. `<p>Your pact code: <strong>{{ .Token }}</strong></p>`); otherwise people get a link instead of a code.
4. Authentication → URL Configuration → **Redirect URLs**: add the extension's redirect URL — shown under "Trouble signing in?" on the sign-in screen (`https://<extension-id>.chromiumapp.org/`). Unpacked builds get a different id per machine; a published extension has a fixed one.
5. Put `WXT_SUPABASE_URL` and `WXT_SUPABASE_PUBLISHABLE_KEY` in `.env.local` (see `.env.example`) and rebuild.

## VibeParty

Open the **VibeParty** page, pick or generate a room code, press **Open YouTube & join**. pact reuses a YouTube tab you already have (or opens one) and shows a panel on the page: people in the room, chat, reactions, and a queue.

- **Sync** — play, pause and seek propagate; small drift is corrected by nudging speed ±5 %, larger drift by seeking. Playback speed is held at 1× during a party.
- **Ads** — an ad on your side never reaches the room; your player sits it out and catches up afterwards.
- **Queue** — add links (titles and thumbnails are fetched from YouTube itself), up-vote, and the most-voted video plays next for everyone when the current one ends.
- **Different video?** If someone switches video you get a "Go to it" banner (or turn on *Follow automatically*).
- **Codes are passwords.** Room codes (`amber-lofi-k7q2x9dm`) carry ~52 bits from `crypto.getRandomValues`. Anyone with the code can join.

### Local vs live

| | Local (default) | Live (relay) |
| --- | --- | --- |
| Setup | none | run the relay, rebuild with its address |
| Who can join | YouTube tabs in **this browser** | anyone with the code, anywhere |
| Where the room lives | the extension's background script | the relay (the extension mirrors it) |

### Running the relay

```bash
bun run relay                                   # ws://127.0.0.1:8787
HOST=0.0.0.0 PORT=8787 ALLOWED_ORIGINS=chrome-extension://<your-extension-id> bun run relay
```

Put TLS in front of it (the extension **refuses plain `ws://` except for localhost**, since an unencrypted relay would leak every code and message). With Caddy, `relay.example.com { reverse_proxy 127.0.0.1:8787 }` is the whole config. Then:

```bash
WXT_VIBEPARTY_WS_URL=wss://relay.example.com bun run build      # or set it in .env
```

The relay keeps rooms in memory (a room disappears ten minutes after it empties) and never logs chat. It enforces: sanitised and size-capped frames (16 KiB), per-connection rate limiting, peer ownership (a socket can't speak for someone else's peer), an optional `Origin` allow-list, heartbeats, and caps on rooms / people / queue / history. Unpacked extensions get a new ID per install path — pin one with a manifest `key` if you use `ALLOWED_ORIGINS` during development.

### How it works (for contributors)

```
YouTube tab ──content script──▶ background (PartyController) ──WebSocket──▶ relay (same Room rules)
 overlay + sync engine            owns the party, survives                    only in "live" mode
                                  service-worker restarts
```

- **No clock ever crosses a hop.** `mediaTime` always means "as of when this message was created"; a receiver anchors it to *its own* clock minus measured latency. Two machines with different system clocks stay in sync (there's a test with a one-hour skew).
- `src/features/party/vibeparty/room.ts` is a pure state machine shared by the extension and the relay; `controller.ts` is the background logic with no browser APIs in it; `sanitize.ts` validates everything crossing a trust boundary.
- The overlay is plain DOM in a shadow root (a framework would cost ~140 kB on every YouTube load) and renders user content with `textContent` only. Keystrokes typed in the panel can't trigger YouTube's hotkeys.

### Known limits

- **Not yet verified on live youtube.com.** It is covered by 120+ unit/integration tests (including real WebSockets with two simulated browsers) and a faithful in-browser harness (`src/dev/vibeparty-harness.html`) — but do a two-browser smoke test before shipping. YouTube's DOM can change; the selectors it relies on (`#movie_player video`, `.ad-showing`) live at the top of `sync-engine.ts`.
- The panel isn't visible in browser fullscreen (the browser only paints the fullscreen element) — theater mode keeps it.
- Shorts and YouTube Music aren't targeted.

## Architecture

```
src/
  entrypoints/    newtab (the app), background (alarms, omnibox, VibeParty), vibeparty.content
  app/            shell: sidebar, top bar, command palette, onboarding, error boundaries, routes
  components/ui/  design system on Base UI: Button, Dialog, Select, Segmented, Tooltip, …
  features/       home · notes · kanban · timer · tools · chat · party · settings   (one folder each)
  store/          cross-cutting Zustand stores + demoServer.ts (the simulated backend)
  lib/            small, tested helpers: hotkeys, fuzzy search, url, motion presets, extension facade, appearance/ (accent, fonts, wallpaper engine)
  styles/         Tailwind v4 theme (OKLCH tokens, light/dark) in globals.css
  dev/            kitchen.html (design-system gallery) and the VibeParty harness — never shipped
server/           the VibeParty relay (runs on Bun or Node)
```

Notable decisions: hash routing with lazy-loaded pages (prefetched when idle); every store is versioned with a real `migrate` and synced across open tabs; the timer stores an absolute end time so it survives navigation; the extension API is wrapped by `lib/ext.ts` so pages also run (degraded) as a plain web page during development; permissions are kept to what's used.

## Data, privacy and permissions

pact makes **no network requests of its own as a guest** (fonts and icons are bundled; site icons come from the browser's local favicon cache). Once you sign in, notes and your profile go to your Supabase project. The only other traffic is the relay *you* configure and, on youtube.com, the video's own watch page (read for its title) and thumbnails for the queue.

| Permission | Why |
| --- | --- |
| `storage` | VibeParty remembers your display name and panel preferences; party state survives service-worker restarts |
| `topSites` | "Most visited" tiles on Home |
| `identity` | "Sign in with GitHub / Google" (`launchWebAuthFlow`); no email or profile permission is requested |
| `favicon` | Private, local site icons (Chromium-only; Firefox falls back to letter tiles) |
| `search` | Search with *your* default search engine |
| `alarms`, `notifications` | The focus timer fires even if every pact tab is closed |
| host `www.youtube.com` | The VibeParty panel, and finding an open YouTube tab to start a party in |

A wallpaper image is stored in this browser's IndexedDB and is **not** part of a Settings backup (the choice of wallpaper is; the picture isn't), so after restoring on another machine you re-pick the image.

## Quality

- **TypeScript 7** strict (`noUncheckedIndexedAccess`), **Biome 2** for lint + format, **Vitest 5** (320+ tests): calculators and converters, stores and their migrations, the chat model, URL/fuzzy helpers — and for VibeParty the room rules, sanitisers, controller lifecycle, sync engine (against a fake `<video>`), overlay (DOM, accessibility, key isolation) and the relay over real sockets.
- Accessibility: landmarks and real roles, labelled controls, focus management in dialogs, `prefers-reduced-motion`, contrast verified numerically for the brand colour — including every accent you can pick.

## Browsers

- **Chrome / Edge / Brave** (MV3, Chrome 116+): primary target.
- **Firefox** (`bun run build:firefox`, MV2): builds and `web-ext lint` reports no errors. Before publishing to AMO, set `browser_specific_settings.gecko.id` and declare data collection (`none`) in `wxt.config.ts`; Firefox ignores the `favicon` permission.
- Safari isn't tested.

## Before you publish

- [ ] Run a two-browser VibeParty smoke test on real YouTube; deploy the relay behind TLS and build with `WXT_VIBEPARTY_WS_URL`.
- [ ] Decide what "friends" means for real: the Chat page needs a backend (auth, storage, realtime). `src/store/demoServer.ts` is the seam.
- [ ] Store listing: screenshots, a privacy policy (it's short: nothing leaves the device except what you configure), permission justifications (table above).
- [ ] Add an end-to-end test that loads the built extension (Playwright + a persistent Chromium context).

## Roadmap

Real accounts and presence · persistent chat history · opt-in encrypted cloud sync · shared notebooks and boards that actually sync · push notifications for messages · localisation.
