import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Disc3,
  ExternalLink,
  MessageCircleMore,
  Music2,
  RefreshCw,
  Sparkles,
  ThumbsUp,
  Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { browser } from 'wxt/browser';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useUserStore } from '@/store/useUserStore';
import type { AppStatus } from '@/src/types/vibeparty';
import { VIBEPARTY_PENDING_KEY } from '@/src/types/vibeparty';

const ROOM_WORDS = [
  'amber', 'lofi', 'neon', 'vinyl', 'cozy', 'groove', 'midnight', 'pixel',
  'sunset', 'velvet', 'aurora', 'disco', 'chill', 'static', 'lunar', 'fuzzy',
];

function generateRoomCode(): string {
  const a = ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)] ?? 'lofi';
  const remaining = ROOM_WORDS.filter((w) => w !== a);
  const b = remaining[Math.floor(Math.random() * remaining.length)] ?? 'vinyl';
  const n = Math.floor(Math.random() * 90) + 10;
  return `${a}-${b}-${n}`;
}

const STEPS = [
  {
    title: 'Grab a room code',
    body: 'Generate one below — it’s your party password. No signup, no links to leak.',
  },
  {
    title: 'Open YouTube, hit play',
    body: 'The VibeParty panel appears on the right. Join with the code — everyone locks to the same playback.',
  },
  {
    title: 'Share the code',
    body: 'Friends join from their own pact hub or by typing the code into the panel. Chat, reactions, and the queue stay in sync.',
  },
];

const FEATURES = [
  { icon: Music2, label: 'Drift-proof sync', hint: 'soft rate nudge under 2s, hard seek beyond' },
  { icon: ThumbsUp, label: 'Democratic queue', hint: 'upvotes re-sort the playlist live' },
  { icon: MessageCircleMore, label: 'Double-tap reactions', hint: 'emoji bursts on any chat message' },
];

export function PartyView() {
  const currentUser = useUserStore((s) => s.currentUser);
  const [room, setRoom] = useState(generateRoomCode);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('pact-vibeparty-name') || currentUser?.displayName || '';
    } catch {
      return currentUser?.displayName || '';
    }
  });
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = (await browser.runtime.sendMessage({ type: 'vibeparty:app-status' })) as AppStatus | undefined;
        if (!cancelled && res && typeof res === 'object') setStatus(res);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(room);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [room]);

  const openYouTube = useCallback(async () => {
    const cleanName = name.trim() || 'guest';
    try {
      localStorage.setItem('pact-vibeparty-name', cleanName);
    } catch {}
    try {
      await browser.storage.local.set({
        [VIBEPARTY_PENDING_KEY]: { room, name: cleanName, at: Date.now() },
      });
    } catch {}
    try {
      await browser.tabs.create({ url: 'https://www.youtube.com' });
    } catch {
      window.open('https://www.youtube.com', '_blank');
    }
  }, [room, name]);

  const live = status?.connected ?? false;
  const totalPeers = status?.rooms.reduce((sum, r) => sum + r.peers, 0) ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto max-w-3xl space-y-4"
    >
      <div className="flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Disc3 className="h-4.5 w-4.5 text-accent" /> VibeParty
          </h2>
          <p className="text-xs text-muted-foreground">Watch together · synced YouTube parties</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
          <motion.span
            animate={live ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
            transition={live ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
            className={`inline-block h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-400' : status?.wsConfigured ? 'bg-amber-400' : 'bg-muted-foreground/50'}`}
          />
          {live ? `live server · ${totalPeers} watching` : status?.wsConfigured ? 'reconnecting…' : 'local hub mode'}
        </div>
      </div>

      <Card className="p-6 md:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Your room</p>

        <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <motion.code
              key={room}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="rounded-sm border border-border bg-muted px-3 py-2 font-mono text-base font-semibold tracking-tight text-foreground md:text-lg"
            >
              {room}
            </motion.code>
            <Button variant="ghost" size="icon" title="New code" onClick={() => setRoom(generateRoomCode())}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Copy code" onClick={() => void copyCode()}>
              <AnimatePresence mode="wait" initial={false}>
                {copied ? (
                  <motion.span key="check" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }}>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  </motion.span>
                ) : (
                  <motion.span key="copy" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }}>
                    <Copy className="h-3.5 w-3.5" />
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </div>

          <div className="w-full sm:w-52">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="your name"
              aria-label="Your name"
              className="h-9 w-full rounded-sm border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-ring"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row">
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="w-full sm:w-auto">
            <Button
              className="h-10 w-full gap-2 bg-accent text-accent-foreground shadow-sm hover:bg-accent/90 sm:w-auto"
              aria-label="Open YouTube and start party"
              onClick={() => void openYouTube()}
            >
              Open YouTube & start party <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            opens YouTube and drops you into <span className="font-mono text-[11px] text-foreground">#{room}</span> automatically
          </p>
        </div>
      </Card>

      <AnimatePresence initial={false}>
        {status && status.rooms.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <Card title="Active rooms" action={<span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{status.rooms.length}</span>}>
              <ul className="space-y-1.5">
                {status.rooms.map((r) => (
                  <li key={r.room} className="flex items-center justify-between rounded-sm border border-border bg-background px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 font-mono text-xs text-foreground">
                      {r.playing && (
                        <motion.span
                          animate={{ opacity: [1, 0.35, 1] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                          className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
                        />
                      )}
                      #{r.room}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {r.peers}</span>
                      <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" /> {r.queue}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="How it works">
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-accent text-[11px] font-bold text-accent-foreground">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-sm font-medium text-foreground">{step.title}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Built different">
          <ul className="space-y-3">
            {FEATURES.map((f) => (
              <li key={f.label} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground">
                  <f.icon className="h-3.5 w-3.5" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-foreground">{f.label}</span>
                  <span className="block text-xs text-muted-foreground">{f.hint}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-accent" /> No echo loops, no DOM hacks — the panel lives in a Shadow DOM so YouTube can’t break it.
          </p>
        </Card>
      </div>
    </motion.div>
  );
}
