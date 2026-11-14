import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { deleteBlob } from '@/features/chat/idb';
import type { Attachment, Conversation, Message } from '@/features/chat/types';
import { uid } from '@/lib/format';
import { syncAcrossTabs } from '@/lib/persist';
import { ME_ID } from '@/store/useUserStore';

let lastStamp = 0;
/**
 * ISO timestamp that never repeats or runs backwards within a session. Unread
 * tracking compares timestamps, so two events in the same millisecond (your own
 * message followed instantly by a reply) must still order strictly.
 */
const now = () => {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
};
const MAX_MESSAGES = 4000;
const MAX_RECENT_EMOJI = 16;

type ChatState = {
  conversations: Conversation[];
  messages: Message[];
  activeId: string | null;
  search: string;
  /** Unsent text per conversation — survives reloads. */
  drafts: Record<string, string>;
  recentEmoji: string[];
  /** Transient (not persisted): who is currently "typing" in each conversation. */
  typing: Record<string, string[]>;
  /** Transient: message being replied to, per conversation. */
  replyingTo: Record<string, string | null>;

  setSearch: (q: string) => void;
  setActive: (id: string | null) => void;
  markRead: (id: string) => void;

  /** Returns the DM with this person, creating it if needed. */
  ensureDm: (personId: string) => string;
  createGroup: (name: string, memberIds: string[]) => string;
  deleteConversation: (id: string) => Conversation | null;

  /** Add a message to a conversation. `senderId === ME_ID` for your own. */
  addMessage: (m: Omit<Message, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) => Message;
  toggleReaction: (messageId: string, emoji: string, personId: string) => void;
  deleteMessage: (id: string) => void;
  restoreMessage: (id: string) => void;

  setDraft: (conversationId: string, text: string) => void;
  setReplyingTo: (conversationId: string, messageId: string | null) => void;
  setTyping: (conversationId: string, personId: string, typing: boolean) => void;
  pushRecentEmoji: (emoji: string) => void;
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      messages: [],
      activeId: null,
      search: '',
      drafts: {},
      recentEmoji: [],
      typing: {},
      replyingTo: {},

      setSearch: (search) => set({ search }),
      setActive: (activeId) => set({ activeId }),

      markRead: (id) =>
        set((s) => {
          const c = s.conversations.find((x) => x.id === id);
          if (!c) return s;
          const latest = s.messages.reduce((m, x) => (x.conversationId === id && x.createdAt > m ? x.createdAt : m), c.lastReadAt);
          if (latest <= c.lastReadAt) return s;
          return { conversations: s.conversations.map((x) => (x.id === id ? { ...x, lastReadAt: latest } : x)) };
        }),

      ensureDm: (personId) => {
        const existing = get().conversations.find((c) => c.kind === 'dm' && c.participantIds.includes(personId));
        if (existing) return existing.id;
        const stamp = now();
        const conv: Conversation = {
          id: uid('dm'),
          kind: 'dm',
          participantIds: [ME_ID, personId],
          createdAt: stamp,
          lastMessageAt: stamp,
          lastReadAt: stamp,
        };
        set((s) => ({ conversations: [conv, ...s.conversations] }));
        return conv.id;
      },

      createGroup: (name, memberIds) => {
        const stamp = now();
        const conv: Conversation = {
          id: uid('grp'),
          kind: 'group',
          name: name.trim() || 'New group',
          participantIds: [ME_ID, ...memberIds.filter((m) => m !== ME_ID)],
          createdAt: stamp,
          lastMessageAt: stamp,
          lastReadAt: stamp,
        };
        set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id }));
        return conv.id;
      },

      deleteConversation: (id) => {
        const conv = get().conversations.find((c) => c.id === id);
        if (!conv) return null;
        const doomed = get().messages.filter((m) => m.conversationId === id);
        for (const m of doomed) for (const a of m.attachments ?? []) void deleteBlob(a.id).catch(() => {});
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          messages: s.messages.filter((m) => m.conversationId !== id),
          activeId: s.activeId === id ? null : s.activeId,
        }));
        return conv;
      },

      addMessage: (input) => {
        const msg: Message = { ...input, id: input.id ?? uid('m'), createdAt: input.createdAt ?? now() };
        set((s) => {
          const messages = [...s.messages, msg];
          const trimmed = messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages;
          return {
            messages: trimmed,
            conversations: s.conversations.map((c) =>
              c.id === msg.conversationId
                ? {
                    ...c,
                    lastMessageAt: msg.createdAt,
                    // your own messages never count as unread
                    lastReadAt: msg.senderId === ME_ID ? msg.createdAt : c.lastReadAt,
                  }
                : c,
            ),
          };
        });
        return msg;
      },

      toggleReaction: (messageId, emoji, personId) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const reactions = [...(m.reactions ?? [])];
            const i = reactions.findIndex((r) => r.emoji === emoji);
            const existing = reactions[i];
            if (existing) {
              const by = existing.by.includes(personId) ? existing.by.filter((p) => p !== personId) : [...existing.by, personId];
              if (by.length) reactions[i] = { ...existing, by };
              else reactions.splice(i, 1);
            } else {
              reactions.push({ emoji, by: [personId] });
            }
            return { ...m, reactions };
          }),
        })),

      deleteMessage: (id) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, deleted: true } : m)),
        })),

      restoreMessage: (id) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, deleted: false } : m)),
        })),

      setDraft: (conversationId, text) =>
        set((s) => {
          const drafts = { ...s.drafts };
          if (text) drafts[conversationId] = text;
          else delete drafts[conversationId];
          return { drafts };
        }),

      setReplyingTo: (conversationId, messageId) => set((s) => ({ replyingTo: { ...s.replyingTo, [conversationId]: messageId } })),

      setTyping: (conversationId, personId, typing) =>
        set((s) => {
          const current = s.typing[conversationId] ?? [];
          const next = typing ? (current.includes(personId) ? current : [...current, personId]) : current.filter((p) => p !== personId);
          return { typing: { ...s.typing, [conversationId]: next } };
        }),

      pushRecentEmoji: (emoji) =>
        set((s) => ({ recentEmoji: [emoji, ...s.recentEmoji.filter((e) => e !== emoji)].slice(0, MAX_RECENT_EMOJI) })),
    }),
    {
      name: 'pact-chat',
      version: 2,
      partialize: (s) => ({
        conversations: s.conversations,
        messages: s.messages,
        activeId: s.activeId,
        drafts: s.drafts,
        recentEmoji: s.recentEmoji,
      }),
      migrate: (persisted) => {
        // v1: `isSpace`/`spaceName`, attachments with dead blob:/remote URLs, no read state.
        const p = (persisted ?? {}) as {
          conversations?: Array<Record<string, unknown>>;
          messages?: Array<Record<string, unknown>>;
          activeId?: string;
        };
        const conversations: Conversation[] = (p.conversations ?? []).map((c) => {
          const last = (c.lastMessageAt as string) ?? now();
          return {
            id: String(c.id),
            kind: c.isSpace ? 'group' : 'dm',
            name: (c.spaceName as string | undefined) ?? undefined,
            participantIds: (c.participantIds as string[]) ?? [ME_ID],
            createdAt: last,
            lastMessageAt: last,
            lastReadAt: last, // everything that existed is considered read
          };
        });
        const messages: Message[] = (p.messages ?? []).map((m) => ({
          id: String(m.id),
          conversationId: String(m.conversationId),
          senderId: String(m.senderId),
          body: String(m.body ?? ''),
          createdAt: String(m.createdAt ?? now()),
          replyTo: m.replyTo as string | undefined,
          // attachments are dropped: their blob:/remote URLs no longer resolve
        }));
        return {
          conversations,
          messages,
          activeId: conversations.some((c) => c.id === p.activeId) ? (p.activeId as string) : null,
          drafts: {},
          recentEmoji: [],
        } as unknown as ChatState;
      },
    },
  ),
);

syncAcrossTabs('pact-chat', useChatStore);

// ── selectors / helpers ───────────────────────────────────────────────────────

export function unreadCount(c: Conversation, messages: Message[]): number {
  return messages.reduce(
    (n, m) => (m.conversationId === c.id && m.senderId !== ME_ID && !m.deleted && m.createdAt > c.lastReadAt ? n + 1 : n),
    0,
  );
}

export const selectTotalUnread = (s: ChatState) => s.conversations.reduce((n, c) => n + unreadCount(c, s.messages), 0);

export function lastMessageOf(messages: Message[], conversationId: string): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.conversationId === conversationId && !m.deleted) return m;
  }
  return undefined;
}

export type { Attachment };
