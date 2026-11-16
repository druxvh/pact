import { Check, Clock, Copy, Disc3, ExternalLink, Info, MessageCircle, RefreshCw, Server, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownTrigger,
  IconButton,
  Input,
  Label,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { useChatStore } from '@/features/chat/store';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '@/features/party/roomCode';
import { usePartyStore } from '@/features/party/store';
import { type AppStatus, type ConnectionMode, type OpenResult, VIBEPARTY_NAME_KEY } from '@/features/party/vibeparty/protocol';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { sendToBackground, storeLocal } from '@/lib/ext';
import { relativeTime } from '@/lib/format';
import { fadeUp, spring, stagger } from '@/lib/motion';
import { notify } from '@/lib/toast';
import { sendMessage } from '@/store/demoServer';
import { useUiStore } from '@/store/useUiStore';
import { findPerson, useUserStore } from '@/store/useUserStore';

const inviteText = (room: string) => `🍿 Join my VibeParty — room code: ${room}`;

const STEPS = [
  ['Pick a room code', 'A fresh, unguessable one is ready for you. The code is the room’s password — share it only with people you want there.'],
  ['Open YouTube and join', 'pact reuses a YouTube tab you already have open (or opens one) and puts the VibeParty panel on the page.'],
  ['Watch, chat, queue', 'Play, pause and seek stay in sync. Add videos to the shared queue — the most upvoted plays next.'],
] as const;

const GOOD_TO_KNOW = [
  'Ads: when an ad plays on your side your player sits it out, then catches up. It never drags anyone else into your ad.',
  'Playback speed is held at 1× during a party so everyone stays together; tiny drift is corrected by gently nudging speed.',
  'The panel isn’t visible in fullscreen (the browser only draws the video). Theater mode keeps it on screen.',
  'Press Escape in the panel’s chat box to hand the keyboard back to YouTube.',
] as const;

// ── connection status ────────────────────────────────────────────────────────

/** `undefined` = still asking · `null` = no extension runtime (running as a plain web page). */
function useStatus(): AppStatus | null | undefined {
  const [status, setStatus] = useState<AppStatus | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const s = await sendToBackground<AppStatus>({ type: 'vibeparty:app-status' });
      if (alive) setStatus(s);
    };
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    void load();
    const id = window.setInterval(refresh, 4000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return status;
}

function ModeBadge({ status }: { status: AppStatus | null | undefined }) {
  if (status === undefined) return <Skeleton className="h-6 w-28 rounded-lg" />;
  if (status === null) {
    return (
      <Badge
        tone="outline"
        className="h-6 gap-1.5 px-2.5 text-xs"
        title="pact is running as a plain web page, so there is no browser to start a party in. Load it as an extension."
      >
        <Info /> Preview mode
      </Badge>
    );
  }
  const watching = status.rooms.reduce((n, r) => n + r.peers, 0);
  const mode: Record<ConnectionMode, { tone: 'neutral' | 'success' | 'warning'; label: string; hint: string }> = {
    local: {
      tone: 'neutral',
      label: 'This browser',
      hint: 'Parties sync the YouTube tabs in this browser. A relay is needed to watch with friends elsewhere.',
    },
    live: {
      tone: 'success',
      label: watching > 0 ? `Live · ${watching} watching` : 'Live',
      hint: 'Connected to a relay — friends can join from anywhere with the room code.',
    },
    reconnecting: { tone: 'warning', label: 'Reconnecting…', hint: 'The relay is unreachable. Changes stay on this browser until it’s back.' },
  };
  const m = mode[status.mode];
  return (
    <Badge tone={m.tone} className="h-6 gap-1.5 px-2.5 text-xs" title={m.hint}>
      <span className="relative flex size-1.5">
        {status.mode !== 'local' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
        <span className="relative inline-flex size-1.5 rounded-full bg-current" />
      </span>
      {m.label}
    </Badge>
  );
}

function ModeExplainer({ status }: { status: AppStatus | null | undefined }) {
  if (status === undefined) return null;
  const copyCmd = () => void copyText('bun run relay', 'Command copied');

  if (status === null) {
    return (
      <Card className="border-dashed bg-transparent shadow-none">
        <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            You’re viewing pact as a regular web page, so VibeParty can’t reach a browser to start a party in. Load the built extension (
            <code className="font-mono text-xs">bun run dev</code> opens a browser with it installed) to try it for real.
          </span>
        </p>
      </Card>
    );
  }

  const text =
    status.mode === 'live'
      ? 'Connected to a relay: anyone with the room code can join from any computer. Chat and the queue are shared; playback is kept in sync across the internet.'
      : status.mode === 'reconnecting'
        ? 'A relay is configured but can’t be reached right now. Everything keeps working between YouTube tabs in this browser, and changes made meanwhile stay here.'
        : 'No relay is configured, so a party syncs the YouTube tabs inside this browser only — handy for trying it out or watching on two screens. To watch with friends on other computers, run the relay and point pact at it.';

  return (
    <Card title="Where parties run" action={<Server className="size-4 text-muted-foreground" />}>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{text}</p>
      {status.mode === 'local' && (
        <div className="mt-3 space-y-2 rounded-lg border bg-muted/40 p-3 text-[12.5px]">
          <p className="text-muted-foreground">Start a relay (needs Bun or Node), then rebuild with its address:</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1.5 font-mono text-xs">bun run relay</code>
            <IconButton label="Copy command" size="icon-sm" onClick={copyCmd}>
              <Copy />
            </IconButton>
          </div>
          <code className="block truncate rounded-md bg-background px-2 py-1.5 font-mono text-xs">
            WXT_VIBEPARTY_WS_URL=wss://your-relay.example bun run build
          </code>
          <p className="text-subtle-foreground">Remote relays must use wss:// — the extension refuses unencrypted ones. See the README for deployment.</p>
        </div>
      )}
    </Card>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────

export function PartyView() {
  const profileName = useUserStore((s) => s.currentUser.displayName);
  const friendIds = useUserStore((s) => s.friendIds);
  const { name, setName, recent, remember, forget, clearRecent } = usePartyStore();
  const status = useStatus();

  const [code, setCode] = useState(() => useUiStore.getState().partyRoom ?? generateRoomCode());
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState<'code' | 'invite' | null>(null);
  const [spin, setSpin] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  // A code handed over from Chat ("Join the party" / "Watch together") — take it once.
  useEffect(() => {
    const incoming = useUiStore.getState().partyRoom;
    if (!incoming) return;
    useUiStore.getState().setPartyRoom(null);
    notify.info('Room code filled in from chat');
  }, []);

  const room = normalizeRoomCode(code);
  const valid = isValidRoomCode(room);
  const touched = code.length > 0;
  const displayName = (name || profileName).trim() || 'guest';
  const friends = friendIds.map(findPerson).filter((p): p is NonNullable<typeof p> => Boolean(p));

  const flash = (what: 'code' | 'invite') => {
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const start = async (target = room) => {
    if (!isValidRoomCode(target)) return;
    setOpening(true);
    setUnavailable(false);
    void storeLocal({ [VIBEPARTY_NAME_KEY]: displayName });
    const res = await sendToBackground<OpenResult>({ type: 'vibeparty:open', room: target, name: displayName });
    setOpening(false);
    if (res === null) {
      setUnavailable(true);
      return;
    }
    if (!res.ok) {
      notify.error('Couldn’t start the party', res.error);
      return;
    }
    remember(target);
    notify.success(res.reusedTab ? 'Joined in your YouTube tab' : 'Opening YouTube…', `#${target}`);
  };

  const sendInvite = (personId: string) => {
    if (!valid) return;
    const person = findPerson(personId);
    const conversationId = useChatStore.getState().ensureDm(personId);
    sendMessage({ conversationId, body: inviteText(room) });
    remember(room);
    notify.success('Invite sent', `Posted in your chat with ${person?.displayName ?? 'them'}.`);
  };

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="mx-auto w-full max-w-3xl space-y-4">
      <motion.div variants={fadeUp}>
        <PageHeader
          icon={Disc3}
          title="VibeParty"
          description="Watch YouTube in sync — with chat, reactions and a shared queue"
          actions={<ModeBadge status={status} />}
        />
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="gap-5 p-5 sm:p-6">
          <div>
            <Label htmlFor="party-code">Room code</Label>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  id="party-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={48}
                  aria-invalid={touched && !valid ? true : undefined}
                  aria-describedby="party-code-hint"
                  className="h-10 pr-10 font-mono text-[15px] font-semibold tracking-tight"
                />
                <AnimatePresence>
                  {valid && (
                    <motion.span
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={spring.bouncy}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-success-text"
                    >
                      <Check className="size-4" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <IconButton
                label="Generate a new code"
                variant="outline"
                size="icon-lg"
                onClick={() => {
                  setCode(generateRoomCode());
                  setSpin((n) => n + 1);
                }}
              >
                <motion.span animate={{ rotate: spin * 180 }} transition={spring.snappy} className="grid place-items-center">
                  <RefreshCw />
                </motion.span>
              </IconButton>
              <IconButton
                label={copied === 'code' ? 'Copied' : 'Copy code'}
                variant="outline"
                size="icon-lg"
                disabled={!valid}
                onClick={async () => {
                  if (await copyText(room, '')) flash('code');
                }}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={copied === 'code' ? 'ok' : 'copy'}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="grid place-items-center"
                  >
                    {copied === 'code' ? <Check className="text-success-text" /> : <Copy />}
                  </motion.span>
                </AnimatePresence>
              </IconButton>
            </div>
            <p id="party-code-hint" className={cn('mt-1.5 text-xs', touched && !valid ? 'text-destructive-text' : 'text-subtle-foreground')}>
              {touched && !valid
                ? 'Room codes are 4–32 letters, numbers and dashes.'
                : code !== room && valid
                  ? `Will join as #${room}`
                  : 'Anyone with this code can join — treat it like a password.'}
            </p>
          </div>

          <div className="max-w-xs">
            <Label htmlFor="party-name">Your name in the party</Label>
            <Input
              id="party-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              placeholder={profileName || 'guest'}
              autoComplete="nickname"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" variant="primary" disabled={!valid} loading={opening} onClick={() => void start()}>
              <ExternalLink /> Open YouTube &amp; join
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={!valid}
              onClick={async () => {
                if (await copyText(inviteText(room), '')) {
                  flash('invite');
                  notify.success('Invite copied', 'Paste it to a friend — chat links it to this page.');
                }
              }}
            >
              {copied === 'invite' ? <Check className="text-success-text" /> : <Copy />} Copy invite
            </Button>
            <DropdownMenu>
              <DropdownTrigger disabled={!valid} className={buttonClass('outline', 'lg')}>
                <MessageCircle /> Send to a friend
              </DropdownTrigger>
              <DropdownContent align="start" className="w-56">
                <DropdownLabel>Post the invite in chat</DropdownLabel>
                {friends.length === 0 && <DropdownItem disabled>Add friends in Chat first</DropdownItem>}
                {friends.map((p) => (
                  <DropdownItem key={p.id} onClick={() => sendInvite(p.id)}>
                    {p.displayName}
                  </DropdownItem>
                ))}
              </DropdownContent>
            </DropdownMenu>
          </div>

          <AnimatePresence>
            {unavailable && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role="status"
                className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning-text"
              >
                <Info className="mt-0.5 size-4 shrink-0" />
                VibeParty needs pact to be installed as an extension — there’s no browser to open YouTube in from a plain web page.
              </motion.p>
            )}
          </AnimatePresence>
        </Card>
      </motion.div>

      <AnimatePresence initial={false}>
        {status && status.rooms.length > 0 && (
          <motion.div key="active" variants={fadeUp} initial="hidden" animate="show" exit={{ opacity: 0, height: 0 }}>
            <Card title="Happening now" action={<Badge tone="brand">{status.rooms.length}</Badge>}>
              <ul className="space-y-1.5">
                {status.rooms.map((r) => (
                  <li key={r.room} className="flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2">
                    <span className="relative flex size-2 shrink-0">
                      {r.playing && <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />}
                      <span className={cn('relative inline-flex size-2 rounded-full', r.playing ? 'bg-brand' : 'bg-muted-foreground/40')} />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">#{r.room}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular">
                      <Users className="size-3.5" /> {r.peers}
                    </span>
                    <Button size="xs" variant="soft" onClick={() => void start(r.room)}>
                      Go to tab
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={fadeUp}>
        <ModeExplainer status={status} />
      </motion.div>

      {recent.length > 0 && (
        <motion.div variants={fadeUp}>
          <Card
            title="Recent rooms"
            action={
              <Button size="xs" variant="ghost" onClick={clearRecent}>
                Clear
              </Button>
            }
          >
            <ul className="flex flex-wrap gap-2">
              <AnimatePresence initial={false}>
                {recent.map((r) => (
                  <motion.li
                    key={r.code}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={spring.snappy}
                    className="group flex items-center rounded-lg border bg-background/50 pl-3 pr-1 transition-colors hover:border-foreground/25"
                  >
                    <button
                      type="button"
                      onClick={() => setCode(r.code)}
                      className="flex items-center gap-2 py-1 pr-1 text-left outline-offset-2"
                      title="Use this code again"
                    >
                      <span className="font-mono text-xs font-medium">#{r.code}</span>
                      <span className="flex items-center gap-1 text-[11px] text-subtle-foreground">
                        <Clock className="size-3" /> {relativeTime(r.at)}
                      </span>
                    </button>
                    <IconButton label={`Forget ${r.code}`} size="icon-xs" tooltip={false} onClick={() => forget(r.code)}>
                      <X />
                    </IconButton>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </Card>
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="grid gap-4 md:grid-cols-2">
        <Card title="How it works">
          <ol className="space-y-3.5">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-brand-soft text-[11px] font-bold text-brand-text">{i + 1}</span>
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-[13px] leading-snug text-muted-foreground">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Good to know">
          <ul className="space-y-2.5 text-[13px] leading-snug text-muted-foreground">
            {GOOD_TO_KNOW.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-brand" />
                {line}
              </li>
            ))}
          </ul>
        </Card>
      </motion.div>
    </motion.div>
  );
}
