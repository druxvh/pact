/**
 * Start the VibeParty relay:  `bun run relay`   (or `node server/start.ts` on Node 22.18+ / 24+)
 *
 *   PORT              default 8787
 *   HOST              default 127.0.0.1 — set 0.0.0.0 to accept connections from other machines
 *   ALLOWED_ORIGINS   comma-separated, e.g. chrome-extension://abcdefghijklmnop — strongly recommended in production
 *
 * Then build the extension with  WXT_VIBEPARTY_WS_URL=wss://your-host/…  (ws://localhost:8787 is accepted for local testing).
 */
import { startRelay } from './relay.ts';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const relay = await startRelay({ port, host, allowedOrigins, log: (line) => console.log(`[relay] ${line}`) });
console.log(`VibeParty relay listening on ws://${host}:${relay.port}`);
if (!allowedOrigins?.length) console.log('Tip: set ALLOWED_ORIGINS=chrome-extension://<your-extension-id> so random web pages can’t connect.');
if (host !== '127.0.0.1' && host !== 'localhost') console.log('Tip: terminate TLS in front of this (Caddy / nginx / Cloudflare) — the extension requires wss:// for remote relays.');

const shutdown = async () => {
  await relay.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
