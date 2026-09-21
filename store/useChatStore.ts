import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMsg, Conversation } from '@/types/chat';

type ChatState = {
  conversations: Conversation[];
  messages: ChatMsg[];
  activeId: string;
  setActive: (id: string) => void;
  send: (body: string, attachments?: ChatMsg['attachments']) => void;
  addMockReply: (conversationId: string) => void;
  search: string;
  setSearch: (s: string) => void;
};

const now = () => new Date().toISOString();

const seedConvs: Conversation[] = [
  { id: 'dm-alex', participantIds: ['local-user', 'alex'], lastMessageAt: now() },
  { id: 'dm-jordan', participantIds: ['local-user', 'jordan'], lastMessageAt: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: 'dm-sam', participantIds: ['local-user', 'sam'], lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
  { id: 'space-design', participantIds: ['local-user', 'alex', 'jordan'], isSpace: true, spaceName: 'design jam', lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
];

const seedMsgs: ChatMsg[] = [
  { id: 'm1', conversationId: 'dm-alex', senderId: 'alex', body: 'hey — pact is live ✨ black theme is so clean', createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString() },
  { id: 'm2', conversationId: 'dm-alex', senderId: 'local-user', body: 'yess! discord × telegram vibe coming together', createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString() },
  { id: 'm3', conversationId: 'dm-alex', senderId: 'alex', body: 'Standup in 10 — lobby is open. you in?', createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString() },
  { id: 'm4', conversationId: 'dm-jordan', senderId: 'jordan', body: 'Can you invite me to the kanban space?', createdAt: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
  { id: 'm5', conversationId: 'space-design', senderId: 'jordan', body: 'Pushed new notes for onboarding flow — check it', createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(), attachments: [{ id: 'a1', type: 'image', url: 'https://picsum.photos/400/240', name: 'board.png', size: 420000 }] },
];

const REPLIES = [
  'haha agreed 🔥',
  'on it — syncing now',
  'nice! let’s ship',
  'got it, checking the space',
  'pact supremacy 😎',
  'added to kanban ✓',
];

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: seedConvs,
      messages: seedMsgs,
      activeId: 'dm-alex',
      search: '',
      setSearch: (search) => set({ search }),
      setActive: (activeId) => set({ activeId }),
      send: (body, attachments) => {
        const { activeId } = get();
        if (!body.trim() && !attachments?.length) return;
        const msg: ChatMsg = {
          id: crypto.randomUUID(),
          conversationId: activeId,
          senderId: 'local-user',
          body: body.trim(),
          createdAt: now(),
          attachments,
        };
        set((s) => ({
          messages: [...s.messages, msg],
          conversations: s.conversations.map((c) => (c.id === activeId ? { ...c, lastMessageAt: now() } : c)),
        }));
        // mock reply after 900ms
        const otherId = get().conversations.find((c) => c.id === activeId)?.participantIds.find((id) => id !== 'local-user') ?? 'alex';
        setTimeout(() => {
          const reply: ChatMsg = {
            id: crypto.randomUUID(),
            conversationId: activeId,
            senderId: otherId,
            body: REPLIES[Math.floor(Math.random() * REPLIES.length)] ?? 'ok',
            createdAt: now(),
          };
          set((s) => ({
            messages: [...s.messages, reply],
            conversations: s.conversations.map((c) => (c.id === activeId ? { ...c, lastMessageAt: now() } : c)),
          }));
        }, 900);
      },
      addMockReply: (conversationId) => {
        const peer = get().conversations.find((c) => c.id === conversationId)?.participantIds.find((id) => id !== 'local-user') ?? 'alex';
        const reply: ChatMsg = { id: crypto.randomUUID(), conversationId, senderId: peer, body: REPLIES[Math.floor(Math.random() * REPLIES.length)] ?? 'ok', createdAt: now() };
        set((s) => ({ messages: [...s.messages, reply] }));
      },
    }),
    { name: 'pact-chat' },
  ),
);
