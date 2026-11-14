import { useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Smile, Send, Video, Paperclip, X, Gift } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { useChatStore } from '@/features/chat/store';
import { useUserStore } from '@/store/useUserStore';
import { useNotificationStore } from '@/store/useNotificationStore';

const EMOJIS = ['😀','😂','😍','🔥','✨','🎉','👏','❤️','🙏','😎','🤔','👍','💯','🚀','🌟','⚡','💡','🎨','📦','✅'];

export function ChatroomsView() {
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const send = useChatStore((s) => s.send);
  const search = useChatStore((s) => s.search);
  const setSearch = useChatStore((s) => s.setSearch);
  const teammates = useUserStore((s) => s.teammates);
  const currentUser = useUserStore((s) => s.currentUser);
  const notify = useNotificationStore((s) => s.add);

  const [draft, setDraft] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string; size: number; url?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeConv = conversations.find((c) => c.id === activeId);
  const filteredConvs = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => {
      const label = c.isSpace ? (c.spaceName ?? 'space') : teammates.find((t) => c.participantIds.includes(t.id) && t.id !== 'local-user')?.displayName ?? '';
      return label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    });
  }, [conversations, search, teammates]);

  const activeMessages = messages.filter((m) => m.conversationId === activeId);

  const peer = (() => {
    if (!activeConv) return null;
    if (activeConv.isSpace) return { displayName: activeConv.spaceName ?? 'Space', username: 'space', isOnline: true };
    const pid = activeConv.participantIds.find((id) => id !== 'local-user');
    return teammates.find((t) => t.id === pid) ?? null;
  })();

  function handleSend() {
    if (!draft.trim() && !pendingFile) return;
    const attachments = pendingFile
      ? [{ id: crypto.randomUUID(), type: 'image' as const, url: pendingFile.url ?? 'https://picsum.photos/300/200', name: pendingFile.name, size: pendingFile.size }]
      : undefined;
    if (pendingFile && pendingFile.size > 5 * 1024 * 1024) {
      notify({ title: 'File too large', body: `${pendingFile.name} exceeds 5MB limit`, kind: 'system' });
      return;
    }
    send(draft, attachments);
    setDraft('');
    setPendingFile(null);
    setShowEmoji(false);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex h-[calc(100vh-56px-3rem)] min-h-[520px] overflow-hidden rounded-sm border border-border bg-card">
      <div className="hidden w-[300px] shrink-0 flex-col border-r border-border bg-background md:flex">
        <div className="border-b border-border p-3">
          <div className="relative">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats…" className="h-8 w-full rounded-sm border border-input bg-card pl-3 pr-7 text-sm placeholder:text-muted-foreground outline-none transition-colors focus:border-ring" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-accent">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Direct messages · {filteredConvs.length}</p>
          <div className="mt-1 space-y-1">
            {filteredConvs.map((c) => {
              const p = c.isSpace ? null : teammates.find((t) => c.participantIds.includes(t.id) && t.id !== 'local-user');
              const label = c.isSpace ? (c.spaceName ?? 'Space') : p?.displayName ?? c.id;
              const sub = c.isSpace ? `${c.participantIds.length} members` : p?.isOnline ? 'online' : 'offline';
              const last = messages.filter((m) => m.conversationId === c.id).at(-1)?.body ?? 'No messages';
              const isActive = c.id === activeId;
              return (
                <motion.button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  whileHover={{ x: 1 }}
                  whileTap={{ scale: 0.99 }}
                  className={`flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                >
                  <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-xs font-medium ${isActive ? 'bg-primary-foreground text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {label.slice(0, 1).toUpperCase()}
                    {!c.isSpace && p && (
                      <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 ${isActive ? 'border-primary' : 'border-background'} ${p.isOnline ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-medium ${isActive ? 'text-primary-foreground' : 'text-foreground'}`}>{label}</span>
                    <span className={`block truncate text-xs ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{c.isSpace ? last.slice(0, 28) : sub} {c.isSpace && '· ' + sub}</span>
                  </span>
                  {isActive && <motion.span layoutId="chat-active" className="h-2 w-2 rounded-full bg-primary-foreground" />}
                </motion.button>
              );
            })}
          </div>
          <p className="mt-4 px-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Invite</p>
          <AddFriend />
        </div>

        <div className="border-t border-border p-2">
          <div className="flex items-center gap-2 rounded-sm bg-card p-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary text-xs font-bold text-primary-foreground">
              {(currentUser?.displayName ?? 'Y').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{currentUser?.displayName}</span>
              <span className="block text-xs text-emerald-600 dark:text-emerald-400">● online</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-card">
        <div className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-muted text-xs font-medium text-foreground">
              {(peer?.displayName ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">{peer?.displayName ?? 'Select chat'}</p>
              <p className="text-xs text-muted-foreground">{peer && 'isOnline' in peer && (peer as any).isOnline ? 'online' : 'offline'} — pact chat · Discord × Telegram vibe · 5mb limit</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-sm"><Video className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-card p-4">
          <AnimatePresence initial={false}>
            {activeMessages.map((m) => {
              const isMe = m.senderId === 'local-user';
              const author = isMe ? currentUser : teammates.find((t) => t.id === m.senderId);
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className={`flex gap-3 ${isMe ? 'justify-end' : ''}`}
                >
                  {!isMe && (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted text-xs font-medium text-foreground">
                      {(author?.displayName ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className={`max-w-[72%] ${isMe ? 'order-first' : ''}`}>
                    <div className={`rounded-sm px-3.5 py-2.5 text-sm ${isMe ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-foreground'}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      {m.attachments?.map((a) => (
                        <div key={a.id} className="mt-2 overflow-hidden rounded-sm border border-border">
                          <img src={a.url} alt={a.name} className="max-h-48 w-full object-cover" />
                          <p className="bg-muted px-2 py-1 text-xs text-muted-foreground">{a.name} · {(a.size! / 1024).toFixed(0)}kb</p>
                        </div>
                      ))}
                      <span className={`ml-2 text-[11px] ${isMe ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                  {isMe && (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary text-xs font-medium text-primary-foreground">
                      {(currentUser?.displayName ?? 'Y').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {activeMessages.length === 0 && (
            <div className="rounded-sm border border-dashed border-border bg-background p-6 text-center">
              <p className="text-sm text-foreground">No messages yet</p>
              <p className="text-xs text-muted-foreground">Say hi</p>
            </div>
          )}
          <div className="rounded-sm border border-border bg-muted p-3 text-center">
            <p className="text-xs text-muted-foreground">Send emojis, images, gifs, videos — 5MB limit</p>
          </div>
        </div>

        <AnimatePresence>
          {pendingFile && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mx-3 flex items-center justify-between rounded-sm border border-border bg-muted px-3 py-2 text-xs">
              <span className="truncate text-foreground">{pendingFile.name} · {(pendingFile.size / 1024 / 1024).toFixed(2)} MB</span>
              <button onClick={() => setPendingFile(null)} className="rounded-sm p-1 hover:bg-accent"><X className="h-3 w-3" /></button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showEmoji && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18 }} className="grid grid-cols-10 gap-1 border-t border-border bg-background p-2">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => setDraft((d) => d + e)} className="rounded-sm p-1 text-lg hover:bg-accent">{e}</button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="border-t border-border bg-background p-3">
          <div className="flex items-center gap-2 rounded-sm border border-input bg-card px-2 py-1.5">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-sm" onClick={() => setShowEmoji((v) => !v)} title="Emoji">
              <Smile className={`h-4 w-4 ${showEmoji ? 'text-primary' : 'text-muted-foreground'}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-sm text-muted-foreground" onClick={() => notify({ title: 'GIFs', body: 'GIF picker coming soon', kind: 'system' })}>
              <Gift className="h-4 w-4" />
            </Button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={`Message ${peer?.displayName ?? ''}…`}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 5 * 1024 * 1024 + 1) {
                notify({ title: 'Too large', body: `${f.name} ${(f.size/1024/1024).toFixed(2)}MB > 5MB limit`, kind: 'system' });
                return;
              }
              const url = URL.createObjectURL(f);
              setPendingFile({ name: f.name, size: f.size, url });
            }} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-sm text-muted-foreground" onClick={() => fileRef.current?.click()} title="Attach (≤5mb)">
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-sm text-muted-foreground" onClick={() => fileRef.current?.click()} title="Image">
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button size="icon" className="h-8 w-8 shrink-0 rounded-sm" onClick={handleSend}><Send className="h-4 w-4" /></Button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Enter to send • Shift+Enter new line • 5MB limit</p>
        </div>
      </div>
    </motion.div>
  );
}

function AddFriend() {
  const sendReq = useUserStore((s) => s.sendFriendRequest);
  const reqs = useUserStore((s) => s.friendRequests);
  const accept = useUserStore((s) => s.acceptRequest);
  const teammates = useUserStore((s) => s.teammates);
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const pending = reqs.filter((r) => r.status === 'pending' && r.toId === 'local-user');
  return (
    <div className="mt-2 space-y-2 rounded-sm border border-border bg-card p-2">
      <p className="text-xs font-medium text-foreground">Add by username</p>
      <div className="flex gap-1.5">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@alex" className="min-w-0 flex-1 rounded-sm border border-input bg-background px-2 py-1.5 text-sm outline-none transition-colors focus:border-ring" />
        <Button size="sm" className="rounded-sm" onClick={() => { const r = sendReq(username); setMsg(r.msg); setUsername(''); setTimeout(() => setMsg(null), 2200); }}>Add</Button>
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      <p className="text-[11px] text-muted-foreground">Try: @alex @jordan @sam @riley</p>
      {pending.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Requests</p>
          {pending.map((r) => {
            const from = teammates.find((t) => t.id === r.fromId);
            return (
              <div key={r.id} className="flex items-center justify-between rounded-sm border border-border bg-background px-2 py-1.5">
                <span className="text-xs text-foreground">@{from?.username}</span>
                <Button size="sm" variant="secondary" className="h-7 rounded-sm px-2 text-xs" onClick={() => accept(r.id)}>Accept</Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
