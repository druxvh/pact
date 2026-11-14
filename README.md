# Office Hub Dashboard

Chrome new tab extension built with WXT, React, Tailwind, Zustand, and Supabase.

## Commands

```bash
bun install
bun run dev
bun run build
```

## VibeParty — synchronized YouTube parties

Real-time party mode for `youtube.com` / `music.youtube.com`, with a hub inside pact itself:

- **In-app hub** — `components/sections/PartyView.tsx` (sidebar → **VibeParty**): generate/share a room code, see live room status, then "Open YouTube & start party" auto-joins the room on load
- `entrypoints/vibeparty.content.ts` — content-script entry (matches + run_at live here)
- `src/content/content.ts` — orchestrator wiring sync engine ↔ overlay ↔ background (+ auto-join from the in-app hub)
- `src/content/sync-engine.ts` — HTML5 `<video>` hook, 250 ms echo-suppression lock, soft drift correction (rate 0.95/1.05) vs hard seek (> 2 s)
- `src/content/ui-overlay.ts` + `src/styles/overlay.css` — Shadow DOM (`mode: 'open'`) side panel styled with pact tokens (orange accent, `rounded-sm`): chat, double-tap emoji reactions, democratic queue with live re-sorting upvotes
- `src/background/vibeparty.ts` — service-worker room hub + resilient WebSocket client (`WXT_VIBEPARTY_WS_URL`) + `vibeparty:app-status` for the in-app hub

### Test locally

1. `bun install && bun run dev` (or `bun run build` for a production bundle).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `.output/chrome-mv3-dev` (dev) or `.output/chrome-mv3` (build).
3. Open two YouTube tabs (e.g. the same music video), click the **VibeParty** panel on the right, enter the same room code in both, and join.
4. Play/pause/seek in one tab — the other follows (soft rate correction between 0.3–2 s drift, hard seek beyond 2 s). Chat, double-tap reactions, and queue votes sync across both tabs.
5. Without `WXT_VIBEPARTY_WS_URL` set, rooms run on the local background hub (multi-tab sync on one machine). Set `WXT_VIBEPARTY_WS_URL=ws://…` in `.env` and rebuild to relay through your sync backend.
