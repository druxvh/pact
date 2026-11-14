import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_DIRECTORY, ME_ID, normalizeUsername, useUserStore, validateUsername } from '@/store/useUserStore';
import { membersOf, resolveInvite } from '@/store/members';

describe('usernames', () => {
  it('normalises @handles', () => {
    expect(normalizeUsername('  @Alex ')).toBe('alex');
  });
  it('validates length and charset', () => {
    expect(validateUsername('al')).toMatch(/3/);
    expect(validateUsername('a'.repeat(21))).toMatch(/20/);
    expect(validateUsername('has space')).toBeTruthy();
    expect(validateUsername('emoji🙂')).toBeTruthy();
    expect(validateUsername('Valid_name9')).toBeNull();
    expect(validateUsername('@valid')).toBeNull();
  });
});

describe('friend requests', () => {
  beforeEach(() => {
    useUserStore.setState({
      currentUser: { id: ME_ID, displayName: 'You', username: 'you', isOnline: true },
      teammates: DEMO_DIRECTORY,
      friendIds: [],
      friendRequests: [],
    });
  });

  it('rejects empty, self, and unknown usernames', () => {
    const s = useUserStore.getState();
    expect(s.sendFriendRequest('').ok).toBe(false);
    expect(s.sendFriendRequest('@you').msg).toMatch(/you/i);
    expect(s.sendFriendRequest('nobody').ok).toBe(false);
  });

  it('prevents duplicate pending requests (the old store allowed unlimited duplicates)', () => {
    expect(useUserStore.getState().sendFriendRequest('alex').ok).toBe(true);
    const again = useUserStore.getState().sendFriendRequest('alex');
    expect(again.ok).toBe(false);
    expect(again.msg).toMatch(/pending/);
    expect(useUserStore.getState().friendRequests).toHaveLength(1);
  });

  it('accepting makes them a friend, and cannot be repeated', () => {
    const r = useUserStore.getState().sendFriendRequest('jordan');
    useUserStore.getState().acceptRequest(r.requestId as string);
    expect(useUserStore.getState().friendIds).toEqual(['jordan']);
    useUserStore.getState().acceptRequest(r.requestId as string);
    expect(useUserStore.getState().friendIds).toEqual(['jordan']);
    expect(useUserStore.getState().sendFriendRequest('jordan').msg).toMatch(/already friends/);
  });

  it('adding someone who already asked you simply accepts their request', () => {
    useUserStore.setState({ friendRequests: [{ id: 'fr1', fromId: 'sam', toId: ME_ID, status: 'pending', createdAt: '2026-01-01' }] });
    const r = useUserStore.getState().sendFriendRequest('sam');
    expect(r).toMatchObject({ ok: true, accepted: true });
    expect(useUserStore.getState().friendIds).toContain('sam');
    expect(useUserStore.getState().friendRequests).toHaveLength(1);
  });
});

describe('group invites', () => {
  it('resolves who can be invited', () => {
    expect(resolveInvite([ME_ID], 'alex')).toMatchObject({ ok: true });
    expect(resolveInvite([ME_ID, 'alex'], 'alex')).toMatchObject({ ok: false });
    expect(resolveInvite([ME_ID], 'ghost')).toMatchObject({ ok: false });
    expect(resolveInvite([ME_ID], '')).toMatchObject({ ok: false });
  });
  it('resolves members in order and skips unknown ids', () => {
    expect(membersOf([ME_ID, 'alex', 'deleted-user']).map((p) => p.id)).toEqual([ME_ID, 'alex']);
  });
});
