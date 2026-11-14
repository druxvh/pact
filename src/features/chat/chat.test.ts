import { beforeEach, describe, expect, it } from 'vitest';
import { botReply, typingDuration } from '@/features/chat/bots';
import { buildRows, dayLabel } from '@/features/chat/rows';
import { lastMessageOf, selectTotalUnread, unreadCount, useChatStore } from '@/features/chat/store';
import type { Message } from '@/features/chat/types';
import { findRoomCode, generateRoomCode, isValidRoomCode, normalizeRoomCode, ROOM_CODE_BITS } from '@/features/party/roomCode';
import { ME_ID } from '@/store/useUserStore';

const reset = () =>
  useChatStore.setState({ conversations: [], messages: [], activeId: null, drafts: {}, typing: {}, replyingTo: {}, recentEmoji: [], search: '' });

const msg = (over: Partial<Message> & Pick<Message, 'senderId' | 'createdAt'>): Message => ({
  id: crypto.randomUUID(),
  conversationId: 'c',
  body: 'x',
  ...over,
});

describe('chat store', () => {
  beforeEach(reset);

  it('ensureDm is idempotent per person', () => {
    const a = useChatStore.getState().ensureDm('alex');
    expect(useChatStore.getState().ensureDm('alex')).toBe(a);
    expect(useChatStore.getState().ensureDm('jordan')).not.toBe(a);
    expect(useChatStore.getState().conversations).toHaveLength(2);
  });

  it('tracks unread: others’ new messages count, your own never do, markRead clears', () => {
    const id = useChatStore.getState().ensureDm('alex');
    useChatStore.getState().addMessage({ conversationId: id, senderId: ME_ID, body: 'hi' });
    expect(selectTotalUnread(useChatStore.getState())).toBe(0);
    useChatStore.getState().addMessage({ conversationId: id, senderId: 'alex', body: 'hey' });
    useChatStore.getState().addMessage({ conversationId: id, senderId: 'alex', body: 'you there?' });
    const s = useChatStore.getState();
    expect(unreadCount(s.conversations[0] as NonNullable<(typeof s.conversations)[0]>, s.messages)).toBe(2);
    expect(selectTotalUnread(s)).toBe(2);
    useChatStore.getState().markRead(id);
    expect(selectTotalUnread(useChatStore.getState())).toBe(0);
  });

  it('replying yourself clears the dangling unread state (sending marks everything read up to it)', () => {
    const id = useChatStore.getState().ensureDm('alex');
    useChatStore.getState().addMessage({ conversationId: id, senderId: 'alex', body: 'q?' });
    useChatStore.getState().addMessage({ conversationId: id, senderId: ME_ID, body: 'a' });
    expect(selectTotalUnread(useChatStore.getState())).toBe(0);
  });

  it('toggles reactions per person and removes empty ones', () => {
    const id = useChatStore.getState().ensureDm('alex');
    const m = useChatStore.getState().addMessage({ conversationId: id, senderId: 'alex', body: 'x' });
    useChatStore.getState().toggleReaction(m.id, '🔥', ME_ID);
    useChatStore.getState().toggleReaction(m.id, '🔥', 'alex');
    expect(useChatStore.getState().messages[0]?.reactions).toEqual([{ emoji: '🔥', by: [ME_ID, 'alex'] }]);
    useChatStore.getState().toggleReaction(m.id, '🔥', ME_ID);
    useChatStore.getState().toggleReaction(m.id, '🔥', 'alex');
    expect(useChatStore.getState().messages[0]?.reactions).toEqual([]);
  });

  it('soft-deletes (tombstone) and restores; deleted messages are skipped in previews', () => {
    const id = useChatStore.getState().ensureDm('alex');
    const a = useChatStore.getState().addMessage({ conversationId: id, senderId: 'alex', body: 'first' });
    const b = useChatStore.getState().addMessage({ conversationId: id, senderId: 'alex', body: 'second' });
    useChatStore.getState().deleteMessage(b.id);
    expect(lastMessageOf(useChatStore.getState().messages, id)?.id).toBe(a.id);
    useChatStore.getState().restoreMessage(b.id);
    expect(lastMessageOf(useChatStore.getState().messages, id)?.id).toBe(b.id);
  });

  it('keeps per-conversation drafts, and empty drafts are removed', () => {
    const id = useChatStore.getState().ensureDm('alex');
    useChatStore.getState().setDraft(id, 'half-typed');
    expect(useChatStore.getState().drafts[id]).toBe('half-typed');
    useChatStore.getState().setDraft(id, '');
    expect(id in useChatStore.getState().drafts).toBe(false);
  });

  it('typing indicators add/remove without duplicates and are not persisted', () => {
    const id = useChatStore.getState().ensureDm('alex');
    useChatStore.getState().setTyping(id, 'alex', true);
    useChatStore.getState().setTyping(id, 'alex', true);
    expect(useChatStore.getState().typing[id]).toEqual(['alex']);
    useChatStore.getState().setTyping(id, 'alex', false);
    expect(useChatStore.getState().typing[id]).toEqual([]);
    useChatStore.getState().setTyping(id, 'sam', true);
    expect(JSON.parse(localStorage.getItem('pact-chat') ?? '{}').state?.typing).toBeUndefined();
  });

  it('deleting a conversation removes its messages', () => {
    const id = useChatStore.getState().ensureDm('alex');
    useChatStore.getState().addMessage({ conversationId: id, senderId: ME_ID, body: 'bye' });
    expect(useChatStore.getState().deleteConversation(id)).toBeTruthy();
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().conversations).toHaveLength(0);
  });

  it('migrates the v1 shape and drops attachments whose blob:/remote URLs can no longer load', () => {
    const migrate = useChatStore.persist.getOptions().migrate;
    const out = migrate?.(
      {
        conversations: [
          { id: 'dm-alex', participantIds: ['local-user', 'alex'], lastMessageAt: '2026-01-02T00:00:00.000Z' },
          {
            id: 'space-design',
            participantIds: ['local-user', 'alex', 'jordan'],
            isSpace: true,
            spaceName: 'design jam',
            lastMessageAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        messages: [
          {
            id: 'm1',
            conversationId: 'dm-alex',
            senderId: 'alex',
            body: 'hi',
            createdAt: '2026-01-01T00:00:00.000Z',
            attachments: [{ id: 'a', type: 'image', url: 'blob:dead' }],
          },
        ],
        activeId: 'dm-alex',
      },
      1,
    ) as ReturnType<typeof useChatStore.getState>;
    expect(out.conversations.map((c) => [c.kind, c.name])).toEqual([
      ['dm', undefined],
      ['group', 'design jam'],
    ]);
    expect(out.messages[0]).not.toHaveProperty('attachments');
    expect(out.conversations[0]?.lastReadAt).toBe(out.conversations[0]?.lastMessageAt);
    expect(out.activeId).toBe('dm-alex');
  });
});

describe('thread rows', () => {
  const at = (h: number, m = 0, day = 14) => new Date(2026, 10, day, h, m).toISOString();

  it('groups consecutive same-sender messages within 5 minutes', () => {
    const rows = buildRows(
      [
        msg({ senderId: 'alex', createdAt: at(10, 0) }),
        msg({ senderId: 'alex', createdAt: at(10, 1) }),
        msg({ senderId: 'alex', createdAt: at(10, 2) }),
        msg({ senderId: ME_ID, createdAt: at(10, 3) }),
        msg({ senderId: 'alex', createdAt: at(10, 20) }),
      ],
      false,
    );
    const positions = rows.filter((r) => r.kind === 'msg').map((r) => (r.kind === 'msg' ? r.position : ''));
    expect(positions).toEqual(['first', 'middle', 'last', 'single', 'single']);
  });

  it('inserts a date separator per day and never groups across days', () => {
    const rows = buildRows([msg({ senderId: 'alex', createdAt: at(23, 59, 13) }), msg({ senderId: 'alex', createdAt: at(0, 1, 14) })], false);
    expect(rows.map((r) => r.kind)).toEqual(['date', 'msg', 'date', 'msg']);
    expect(rows.filter((r) => r.kind === 'msg').every((r) => r.kind === 'msg' && r.position === 'single')).toBe(true);
  });

  it('shows sender names in groups only at the start of a run, never for yourself', () => {
    const rows = buildRows(
      [msg({ senderId: 'alex', createdAt: at(10, 0) }), msg({ senderId: 'alex', createdAt: at(10, 1) }), msg({ senderId: ME_ID, createdAt: at(10, 2) })],
      true,
    );
    expect(rows.filter((r) => r.kind === 'msg').map((r) => (r.kind === 'msg' ? r.showName : null))).toEqual([true, false, false]);
  });

  it('labels days relatively', () => {
    const now = new Date(2026, 10, 14, 12);
    expect(dayLabel(new Date(2026, 10, 14, 9), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 10, 13, 23), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 10, 10), now)).toMatch(/Tuesday/);
    expect(dayLabel(new Date(2025, 2, 1), now)).toMatch(/2025/);
  });
});

describe('bot replies', () => {
  const fixed = (v: number) => () => v;
  it('routes by keyword', () => {
    expect(botReply('alex', 'hey there', { rng: fixed(0) })).toBe('hey! 👋');
    expect(botReply('alex', 'thanks a lot', { rng: fixed(0) })).toBe('anytime 🙌');
    expect(botReply('sam', 'add it to the board', { rng: fixed(0) })).toBe('added it to the board ✓');
    expect(botReply('sam', 'starting my pomodoro', { rng: fixed(0) })).toBe('focus mode on 🎧');
    expect(botReply('riley', 'watch something on youtube?', { rng: fixed(0) })).toBe('I’m in — drop the room code 🍿');
    expect(botReply('riley', 'what do you think?', { rng: fixed(0) })).toBe('good question — let me think');
  });
  it('reacts to attachments first and uses persona lines for small talk', () => {
    expect(botReply('alex', 'hey', { hasAttachment: true, rng: fixed(0) })).toBe('love that 📸');
    expect(botReply('sam', 'lol ok', { rng: fixed(0.1) })).toBe('deploying now…');
  });
  it('typing time scales with length but stays bounded', () => {
    expect(typingDuration('ok')).toBeGreaterThanOrEqual(900);
    expect(typingDuration('x'.repeat(500))).toBe(3600);
    expect(typingDuration('a'.repeat(40))).toBeGreaterThan(typingDuration('a'.repeat(10)));
  });
});

describe('VibeParty room codes', () => {
  it('are unguessable: ≥ 50 bits, correct shape, and never repeat (the old format had ~14 bits)', () => {
    expect(ROOM_CODE_BITS).toBeGreaterThanOrEqual(50);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateRoomCode();
      expect(c).toMatch(/^[a-z]+-[a-z]+-[a-hj-km-np-z2-9]{8}$/); // no 0/1/i/l/o look-alikes in the suffix
      expect(isValidRoomCode(c)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBe(2000);
  });
  it('normalises pasted input', () => {
    expect(normalizeRoomCode('  Amber Lofi  K7Q2X9DM ')).toBe('amber-lofi-k7q2x9dm');
    expect(normalizeRoomCode('amber--lofi--')).toBe('amber-lofi');
    expect(normalizeRoomCode('a'.repeat(60))).toHaveLength(32);
    expect(isValidRoomCode('ab')).toBe(false);
    expect(isValidRoomCode('has space')).toBe(false);
  });
  it('finds a code inside a chat message', () => {
    expect(findRoomCode('🍿 Join my VibeParty — room code: amber-lofi-k7q2x9dm')).toBe('amber-lofi-k7q2x9dm');
    expect(findRoomCode('Room code: `zen-wave-abcd2345` come!')).toBe('zen-wave-abcd2345');
    expect(findRoomCode('no code here')).toBeNull();
  });
});
