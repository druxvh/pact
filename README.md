# pact

A new-tab extension for **teams, classes and friends**: notes, a kanban board, a focus timer, tiny private tools, chat — and a *watch YouTube together* mode — on the page you already open a hundred times a day.

Local-first, no accounts, no tracking. Built with WXT, React 19, Tailwind v4, Base UI and Motion.

## What's real and what's a demo

| Area | State |
| --- | --- |
| Home, Notes, Kanban, Focus, Tools, Settings | **Real.** Stored on your device (local storage / IndexedDB). Notes also sync to your account when you sign in (below); the rest stays on the device. Back up, preview and restore from Settings → Your data. |
| Communities | **Real**, Supabase-backed: invite-only groups with channels, moderation and safety tools (below). |
| VibeParty (watch together) | **Real.** Local parties work between YouTube tabs in one browser; signed-in people can join the same party from anywhere through Supabase Realtime — no server to run. |
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
| `bun run zip` / `zip:firefox` | Store-ready archive (leaves the pinned manifest `key` out — see [Stable extension ID](#stable-extension-id)) |
| `bun run check` | Typecheck (TypeScript 7) + Biome + tests — run before committing |
| `bun run test` / `test:watch` | Vitest |
| `bun run lint` / `lint:fix` | Biome |
| `bun run test:db` | Row-level-security and trigger tests against the real migrations in a local PostgreSQL (PGlite) |

## What's inside

| Page | Highlights | Go there |
| --- | --- | --- |
| **Home** | A search box that is also a calculator and converter (`15% of 240`, `10 km in mi`, `time in tokyo`, `days until dec 25`, colours, `uuid`, `roll d20`, `password 20`), searches sites with bangs (`!yt lofi`, or `yt` then <kbd>Tab</kbd> for a site chip) and captures (`timer 25`, `note: …`, `task: …`; sign-in required). Brand-icon shortcuts, most-visited sites, a choice of clocks and optional widgets (see below) | `g h` |
| **Notes** | Notebooks, Markdown editor with live preview, tick checkboxes in the preview, autosave, pins, undo | `g n` |
| **Kanban** | Drag-and-drop with live reordering, priorities, due dates, task details, filters, progress | `g k` |
| **Focus** | Pomodoro that survives navigation and closed tabs (alarms + notification), session history and streaks. **Your own timers**: name, length (1–120 min) and an icon or any emoji, one tap away; the icon follows the session into the ring, the top-bar pill and history | `g t` |
| **Tools** | Calculator, unit converter, colour + contrast, text tools, encoders, password generator, QR codes, image compressor, random picker — and PDF tools: **merge**, **split** (ranges, every N pages, page by page; zip download), **organize pages** (rearrange / rotate / delete / extract), **crop**, **sign** (draw, type or upload), **watermark**, **compress**, **images → PDF** — all on-device, in a Web Worker with progress and a real Cancel | `g o` |
| **Chat** | Two tabs. **Communities**: invite-only Discord-style groups (channels, replies, reactions, memes/GIFs/video, link previews, roles, moderation and safety tools). **Direct messages**: DMs and small groups (still the local demo backend). | `g c` |
| **VibeParty** | Synced YouTube playback, chat, reactions and a shared up-vote queue | `g p` |
| **Settings** | Profile, theme, accent colour, fonts, wallpapers, Home layouts and widgets, animations, backup & restore | `g s` |

Everywhere: `⌘K` / `Ctrl+K` command palette (the same engine as the Home search box: answers, bangs, jump, create, search notes/tasks/chats), `?` for every shortcut, `C` for quick capture, `pact <page>` in the address bar. In the omnibox, `⌘K` or `→` shows actions for the highlighted result, `⌘↵` runs the secondary action, <kbd>Tab</kbd> completes or makes a site chip, and what you pick is remembered and can be pinned (stored on this device; it is fully offline — bangs only navigate when you press Enter). Light and dark themes, reduced-motion support, keyboard-first.

**Quick capture** — the toolbar button (and the shortcut, `Alt+Shift+N` / `⌘⇧Y` by default; rebind at `chrome://extensions/shortcuts`) opens a small sheet: type, <kbd>Tab</kbd> flips Note/Task, `⌘↵` saves. It writes straight to the same stores as the new tab (guests: Home's Quick note); notes upload the next time a pact tab is open. The popup never opens a Supabase session.

## Make it yours

Everything below lives in **Settings → Appearance / Home** and is stored on your device.

**Appearance**
- **Accent colour** — 16 presets or any colour you pick. One choice re-themes every button, highlight, focus ring, brand-coloured text and the **pact logo and tab icon** in both light and dark. The colour is adjusted (not rejected) so text stays at WCAG AA contrast; the stock orange adds no overrides at all.
- **Fonts** — 33 free families: 23 sans-serif (Geist, Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Nunito, DM Sans, Manrope, Plus Jakarta Sans, Outfit, Work Sans, Source Sans 3, Raleway, Space Grotesk, Sora, Figtree, Rubik, IBM Plex Sans, Lexend, Bricolage Grotesque, Instrument Sans), 4 serif (Playfair Display, Merriweather, Lora, Source Serif 4) and 6 monospace for code and numbers (Geist Mono, JetBrains Mono, Fira Code, Source Code Pro, Roboto Mono, IBM Plex Mono), plus your system fonts. All are bundled via Fontsource (Latin subset) and loaded only when you use them — still no network requests.
- **Wallpaper** — solid colours, gradients (presets or your own two colours and angle), mesh gradients, or your own image (downscaled to WebP and kept in IndexedDB). Cards turn into frosted glass over a wallpaper. A **Dim** layer is set per theme, and pact picks the smallest dim that keeps even muted text readable (4.5:1) and tells you when a wallpaper can't be made legible.

**Home**
- **Layouts** — Classic, Minimal, Dashboard, Zen and Focus. Change anything and it becomes *Custom*.
- **Clock** — digital, compact, analog or none; seconds, date and greeting are independent switches; 12h/24h/auto.
- **Show or hide** the search box, keyboard hints and shortcuts.
- **Widgets** (reorderable): *Main focus* (one intention per day, a streak, "Start a focus session"; also for guests), *Today* (overdue / due-today / in-progress tasks — tick them off or add one), *Focus* (minutes today and streak), *Pinned notes*, *Quick note* (saves as a real note), *Quote of the day* (bundled, no network) and *Countdown* to a date you choose. They only read what's already in pact — there's deliberately no weather or news widget, since that would need a network request.

## Accounts and cloud sync (Supabase)

pact works as a **guest** with no account: Home with search, shortcuts (your local bookmarks) and recent/most-visited sites. Everything else needs sign-in with **GitHub or Google** (no password). An emailed one-time code exists too, but is off until you set up custom SMTP (see Setup step 3).

- **Notes** sync to your account, local-first: they're instant and work offline, upload in the background, and appear live on your other devices (Realtime). When the same note was edited in two places, **both versions are kept**: the newer stays, the other becomes `Title (conflict copy, <date>)` in the same notebook (and you get one notice). An edit is never lost to a deletion elsewhere. A note over the server's size limit is set aside as local-only (flagged in the sync badge) instead of blocking everything else. A small cloud icon in the top bar shows whether everything is saved.
- Tasks, timer history, chat and settings still live on this device for now (they're hidden from guests, and a *different* account signing in on the same browser never inherits them).
- **Profile**: a display name, an **@username that is unique** (checked while you type, enforced by the database) and an optional **profile photo** (cropped on-device to 256×256 WebP; stored in a public `avatars` bucket as a *path*, never a URL, so nobody can point their avatar at a server they control).
- Security: Row Level Security on every table (you can only ever read your own rows), only the publishable key ships in the extension, PKCE sign-in through `chrome.identity`. The schema is in `supabase/migrations/`.

**Setup**
1. Apply `supabase/migrations/20261116000000_profiles_and_notes.sql` to your project (SQL editor, or the Supabase CLI / MCP).
2. Authentication → Providers: enable **GitHub** and **Google** (callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`).
3. **Email code sign-in (optional, off by default):** needs custom SMTP (Authentication → Emails → SMTP Settings; Supabase's built-in mailer is rate-limited and templates can't be edited without it). Then edit the *Magic Link* and *Confirm signup* templates so they contain `{{ .Token }}` (e.g. `<p>Your pact code: <strong>{{ .Token }}</strong></p>`) and set `WXT_EMAIL_SIGN_IN=true`.
4. Authentication → URL Configuration → **Redirect URLs**: add `https://kkjbfallganmejcadkcdhppaokcnkefp.chromiumapp.org/*` (the pinned extension ID — see below; also shown under "Trouble signing in?" on the sign-in screen).
5. Put `WXT_SUPABASE_URL` and `WXT_SUPABASE_PUBLISHABLE_KEY` in `.env.local` (see `.env.example`) and rebuild.
6. Apply the later migrations in `supabase/migrations/` too (communities, activity, profile photos, safety, party realtime). If the automated migration tool refuses a file, paste it into the SQL editor (`supabase/pending-setup.sql` is such a paste-ready copy). Realtime → Settings → **Allow public access must be OFF**.

### Stable extension ID

`wxt.config.ts` pins a manifest `key` (a public key; the private half was discarded), so the extension ID is always `kkjbfallganmejcadkcdhppaokcnkefp` — in dev, in a built folder and on every machine — and the sign-in redirect above keeps working. Changing it moves the extension to a new storage area (local data under the old ID isn't carried over). To use the Chrome Web Store's ID instead, set `WXT_EXTENSION_KEY` to the public key shown under *Package → View public key* in the developer dashboard; `bun run zip` leaves the key out (`WXT_OMIT_KEY=1`) so the store can assign its own.

### Data safety

Settings → Your data: **Export/Import** a backup (JSON, includes your wallpaper picture up to 3 MB; older backups still import) always opens a **preview** first — what's inside, Merge vs Replace, and a concrete diff ("2 notes new · 1 would overwrite newer local edits · 1 identical") — and nothing is applied until you confirm. **Rolling snapshots** are kept on this device: one a day when something changed (last 7), plus manual ones and automatic safety copies before a restore, import, sample load or sign-out. Account switches and *Erase everything* delete them. If the app is opened offline with a stored session, it stays usable and says so in the sync badge.

## Communities

Chat → **Communities** is a private, invite-only space for a group (a class, a team, friends). You get in with an invite code or link; nobody can browse or find a community they weren't invited to.

- **Channels** (`#general` to start; the admin adds more), **replies**, **emoji reactions**, **images, GIFs and short video** (up to 25 MB, six per message), and **link previews**.
- **GIF search:** the **GIF** button in the composer searches (or browses trending) GIFs and posts the pick as a picture. It goes through the `gif-search` Edge Function so the provider key never ships in the extension. A GIF is posted as a link to the provider's own copy (not re-hosted); moderators can hide or strip it like any link.
- **Unread counts:** a badge on each community in the sidebar and on each channel, cleared when you read the channel. Read state is stored per person on the server, so it follows you across devices; scrolling up into history, or being on a phone's channel list, doesn't count as reading. Joining late never makes the old history "unread".
- **Typing indicators:** "Ana is typing…" under the messages. These are ephemeral Realtime broadcasts on a private per-community topic (only members can listen or send) and are never stored.
- **Roles:** the **admin** (the creator) appoints **moderators** (sub-admins). Moderators can *hide* a message (members then see only "a moderator hid this message"; the original is kept for moderators and can be restored), *remove links* from a message, create invites, and remove or ban ordinary members. Only the admin manages channels, roles and the community itself (moderators may also set a channel's slowmode).
- **Safety tools:** per-channel **slowmode** (5 s – 6 h; moderators and the admin are exempt; enforced with the server's clock); **timeouts** (60 s – 28 days — the person can read but not post or react, and can't leave and rejoin to dodge it; the admin can time out moderators, moderators only members); a **ban list** for moderators (who, why, by whom, with Unban); **admin transfer** (the old admin becomes a moderator, in one transaction — a community always has exactly one admin, and it no longer disappears if its original creator deletes their account). An admin can't leave without transferring.
- **Notifications:** the Chat badge in the sidebar and the tab title `(3) …` include communities (muted ones excluded), a new message in a channel you're not viewing becomes one in-app notification, and only replies to you and @mentions of your username toast. Per-community **mute** in the community menu.
- **Invites** can expire, have a use limit, and be revoked; codes are always generated (never chosen), guessing them is rate-limited, and banned people can't rejoin. A ban removes the membership in the same statement; only the admin, or the moderator who issued a ban, can lift it.
- **Hardened against abuse** (each has a regression test in `supabase/tests/rls.mjs`): moderation records can't be forged or planted (originals are written only by a SECURITY DEFINER trigger), every moderation time and `created_at` is stamped by the server, UPDATE grants are per column (no forced joins), a hidden or deleted message's attachment can no longer be opened by ordinary members, and there are caps (50 channels, 50 open invites, 20 reactions per message, 300 uploads per person per community).
- **Privacy:** members can read each other's public profile (name, @username, role, bio) — never an email. Files are in a private bucket behind short-lived links. Link previews are fetched by the server, so your browser never contacts the linked site just to show a card (and a server-side guard refuses internal/private addresses).
- Everything is enforced by the database (Row Level Security), not just the UI: `supabase/migrations/*_communities.sql`. `bun run test:db` runs 100+ checks of those rules (communities, safety, profiles, party) against the real migrations in a local PostgreSQL.

**Deleting** a community (or a channel) also deletes its uploaded files from Storage, so nothing is left behind in the bucket (admin only; files are removed first, because once the community is gone no one is a member any more and Storage's rules would refuse). Files from a message its author deleted themselves, and from people who left, stay until the community is deleted.

To enable: apply the migrations in `supabase/migrations` in order, deploy the Edge Functions `link-preview` and `gif-search` (`supabase/functions/*`), and sign in. GIF search additionally needs a KLIPY API key (klipy.com) set as the function secret `KLIPY_API_KEY` (Dashboard → Edge Functions → Secrets, or `supabase secrets set KLIPY_API_KEY=…`); without it everything else works and the picker says GIF search isn't set up yet. Not yet built: a "new messages" divider and a browser-level (OS) notification when the tab is hidden.

## VibeParty

Open the **VibeParty** page, pick or generate a room code, press **Open YouTube & join**. pact reuses a YouTube tab you already have (or opens one) and shows a panel on the page: people in the room, chat, reactions, and a queue.

- **Sync** — play, pause and seek propagate; small drift is corrected by nudging speed ±5 %, larger drift by seeking. Playback speed is held at 1× during a party.
- **Ads** — an ad on your side never reaches the room; your player sits it out and catches up afterwards.
- **Queue** — add links (titles and thumbnails are fetched from YouTube itself), up-vote, and the most-voted video plays next for everyone when the current one ends.
- **Different video?** If someone switches video you get a "Go to it" banner (or turn on *Follow automatically*).
- **Watch together** — on any YouTube watch page there's a "Watch together" button next to Like/Share: one click starts a party for that video, copies an invite (`…/watch?v=…&pact=<CODE>`) and opens the panel. Friends paste the link (or the code) and are *offered* to join — never joined automatically.
- **Codes are passwords.** Room codes (`amber-lofi-k7q2x9dm`) carry ~52 bits from `crypto.getRandomValues`. Anyone with the code can join (signed-in people only for live parties).

### Local vs live

| | Local (guests) | Live (signed in) |
| --- | --- | --- |
| Setup | none | none — Supabase Realtime, nothing to host |
| Who can join | YouTube tabs in **this browser** | anyone with the code, anywhere |
| Where the room lives | the extension | one private Realtime channel per room (`party:<code>`); one member's browser acts as the hub and the role migrates if they leave |

Live parties need the migration `20261118000200_party_realtime.sql` (it only lets signed-in users listen and announce on `party:<code>` topics) and Realtime → Settings → *Allow public access* **OFF**. The connection is owned by a hidden **offscreen document** (`offscreen` permission, no install warning) that shares the signed-in session, so a party keeps running with every pact tab closed.

### How it works (for contributors)

```
YouTube tab ──content script──▶ background (thin router) ──▶ offscreen host (PartyController)
 overlay + sync engine + button   holds no state                    │
                                                                    └── Supabase Realtime ── other members
                                                                        (Presence: roster + hub claim; Broadcast: playback, chat, queue)
```

- **No clock ever crosses a hop.** `mediaTime` always means "as of when this message was created"; a receiver anchors it to *its own* clock minus measured latency. Two machines with different system clocks stay in sync (there's a test with a one-hour skew).
- `room.ts` is a pure state machine; `hub.ts` applies it for the whole room (the relay's old job, now run by one member, elected by smallest client id and replaceable if it stops answering); `realtime-client.ts` is the transport with backoff and a stable per-browser identity (so a reconnect reclaims its own presence entry instead of being refused); `sanitize.ts` validates and size-caps everything crossing a trust boundary. Firefox MV2 runs the same host in the persistent background page.
- The overlay is plain DOM in a shadow root (a framework would cost ~140 kB on every YouTube load) and renders user content with `textContent` only. Keystrokes typed in the panel can't trigger YouTube's hotkeys.

### Known limits

- **Not yet verified on live youtube.com or against real Realtime.** It is covered by 200+ unit/integration tests (two simulated browsers against a faithful fake Realtime server) and an in-browser harness — but do a two-browser smoke test before shipping. An abrupt hub crash costs up to ~15 s of room-wide sync; playback error across the room is ~100–300 ms. YouTube's DOM can change; the selectors it relies on (`#movie_player video`, `.ad-showing`, the Like/Share row) live in `sync-engine.ts` and `watch-button.ts` (which falls back to a floating button).
- The panel isn't visible in browser fullscreen (the browser only paints the fullscreen element) — theater mode keeps it.
- Shorts and YouTube Music aren't targeted.

## Architecture

```
src/
  entrypoints/    newtab (the app), capture (toolbar popup), privacy (policy page), party-host (offscreen VibeParty host), background (alarms, omnibox, router), vibeparty.content
  app/            shell: sidebar, top bar, command palette, onboarding, error boundaries, routes
  components/ui/  design system on Base UI: Button, Dialog, Select, Segmented, Tooltip, …
  features/       home · notes · kanban · timer · tools · chat · party · settings   (one folder each)
  store/          cross-cutting Zustand stores + demoServer.ts (the simulated backend)
  lib/            small, tested helpers: hotkeys, fuzzy search, url, motion presets, extension facade, appearance/ (accent, fonts, wallpaper, favicon), omnibox/ (answer engine, bangs, ranking), backup/ (snapshots, import preview), supabase/ (client, auth, profile, avatar)
  styles/         Tailwind v4 theme (OKLCH tokens, light/dark) in globals.css
  dev/            kitchen.html (design-system gallery) and the harnesses — never shipped
supabase/         migrations, Edge Functions (link-preview, gif-search) and the PGlite rule tests (tests/)
PRIVACY.md        the privacy policy (also bundled as an offline page)
```

Notable decisions: hash routing with lazy-loaded pages (prefetched when idle); every store is versioned with a real `migrate` and synced across open tabs; the timer stores an absolute end time so it survives navigation; the extension API is wrapped by `lib/ext.ts` so pages also run (degraded) as a plain web page during development; permissions are kept to what's used.

## Data, privacy and permissions

pact makes **no network requests of its own as a guest** (fonts and icons are bundled; site icons come from the browser's local favicon cache). Once you sign in, notes, your profile (including a photo you upload), communities and live VibeParty traffic go to your Supabase project; link previews and GIF search go through its Edge Functions. On youtube.com, the video's own watch page (read for its title) and thumbnails for the queue are fetched. There is no analytics or advertising. The full policy is [PRIVACY.md](PRIVACY.md) (also in Settings → About).

| Permission | Why |
| --- | --- |
| `storage` | VibeParty remembers your display name and panel preferences; party state survives service-worker restarts |
| `topSites` | "Most visited" tiles on Home |
| `identity` | "Sign in with GitHub / Google" (`launchWebAuthFlow`); no email or profile permission is requested |
| `favicon` | Private, local site icons (Chromium-only; Firefox falls back to letter tiles) |
| `search` | Search with *your* default search engine |
| `alarms`, `notifications` | The focus timer fires even if every pact tab is closed |
| `offscreen` | Keeps a live VibeParty connected while no pact tab is open (a hidden page, only while a party runs; no install warning) |
| host `www.youtube.com` | The VibeParty panel, and finding an open YouTube tab to start a party in |

A wallpaper image is stored in this browser's IndexedDB and **is** part of a Settings backup (capped at 3 MB, shrunk if larger).

## Quality

- **TypeScript 7** strict (`noUncheckedIndexedAccess`), **Biome 2** for lint + format, **Vitest 5** (1,100+ tests) plus 100+ database-rule checks (`bun run test:db`): answer parsers and the omnibox engine, stores and their migrations, the notes sync model (two devices against a fake server), backups, PDF engine/worker protocol/zip writer, communities, and for VibeParty the room rules, hub election, transport against a fake Realtime server, sync engine (against a fake `<video>`) and overlay.
- Accessibility: landmarks and real roles, labelled controls, focus management in dialogs, `prefers-reduced-motion`, contrast verified numerically for the brand colour — including every accent you can pick.

## Browsers

- **Chrome / Edge / Brave** (MV3, Chrome 116+): primary target.
- **Firefox** (`bun run build:firefox`, MV2): builds and `web-ext lint` reports no errors. Before publishing to AMO, set `browser_specific_settings.gecko.id` and declare data collection (`none`) in `wxt.config.ts`; Firefox ignores the `favicon` permission.
- Safari isn't tested.

## Before you publish

- [ ] Apply the pending migrations (see `supabase/pending-setup.sql`), set the `KLIPY_API_KEY` secret, turn Realtime "Allow public access" **off**, and add the pinned redirect URL to Supabase.
- [ ] Run a two-browser VibeParty smoke test on real YouTube (live party through Realtime, Watch-together button, invite link).
- [ ] Decide what "friends" means for real: the Chat page needs a backend (auth, storage, realtime). `src/store/demoServer.ts` is the seam.
- [ ] Store listing: screenshots, a public URL for `PRIVACY.md` (finish its `TODO(owner)` placeholders first: date, legal name, contact), permission justifications (table above).
- [ ] Add an end-to-end test that loads the built extension (Playwright + a persistent Chromium context).

## Roadmap

Real accounts and presence · persistent chat history · opt-in encrypted cloud sync · shared notebooks and boards that actually sync · push notifications for messages · localisation.
